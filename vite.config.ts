import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { spawn, execSync, type ChildProcess } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { config } from 'dotenv'

// Load .env file
config()

function findComfyUI(): string | null {
  // 1. Check .env / environment variable
  if (process.env.COMFYUI_PATH && existsSync(resolve(process.env.COMFYUI_PATH, 'main.py'))) {
    return process.env.COMFYUI_PATH
  }
  const home = process.env.USERPROFILE || process.env.HOME || ''
  // 2. Check common locations
  const fixed = [
    resolve(home, 'ComfyUI'),
    resolve(home, 'Desktop/ComfyUI'),
    resolve(home, 'Documents/ComfyUI'),
    'C:\\ComfyUI',
  ]
  for (const p of fixed) {
    if (existsSync(resolve(p, 'main.py'))) return p
  }
  // 3. Deep scan Desktop and Documents (one level of subdirectories)
  const scanDirs = [resolve(home, 'Desktop'), resolve(home, 'Documents')]
  for (const dir of scanDirs) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const candidate = join(dir, entry.name, 'ComfyUI')
          if (existsSync(resolve(candidate, 'main.py'))) return candidate
          // Also check if the folder itself IS ComfyUI
          if (existsSync(resolve(dir, entry.name, 'main.py'))) return join(dir, entry.name)
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  return null
}

function isComfyRunning(): Promise<boolean> {
  return fetch('http://localhost:8188/system_stats')
    .then(r => r.ok)
    .catch(() => false)
}

function comfyLauncher(): Plugin {
  let comfyProcess: ChildProcess | null = null
  let comfyLogs: string[] = []

  const startComfy = (comfyPath: string): { status: string; path: string } => {
    if (comfyProcess && !comfyProcess.killed) {
      return { status: 'already_running', path: comfyPath }
    }

    comfyLogs = []
    comfyProcess = spawn('python', ['main.py', '--listen', '127.0.0.1', '--port', '8188'], {
      cwd: comfyPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    comfyProcess.stdout?.on('data', (d) => {
      const line = d.toString()
      comfyLogs.push(line)
      if (comfyLogs.length > 200) comfyLogs.shift()
    })
    comfyProcess.stderr?.on('data', (d) => {
      const line = d.toString()
      comfyLogs.push(line)
      if (comfyLogs.length > 200) comfyLogs.shift()
    })
    comfyProcess.on('exit', () => { comfyProcess = null })

    console.log(`[ComfyUI] Starting from: ${comfyPath}`)
    return { status: 'started', path: comfyPath }
  }

  const stopComfy = () => {
    if (comfyProcess && !comfyProcess.killed) {
      // Kill process tree on Windows
      try {
        if (process.platform === 'win32' && comfyProcess.pid) {
          execSync(`taskkill /pid ${comfyProcess.pid} /T /F`, { stdio: 'ignore' })
        } else {
          comfyProcess.kill('SIGTERM')
        }
      } catch { /* already dead */ }
      comfyProcess = null
      console.log('[ComfyUI] Stopped')
    }
  }

  return {
    name: 'comfy-launcher',
    configureServer(server) {
      // Auto-start ComfyUI when dev server starts
      isComfyRunning().then(running => {
        if (!running) {
          const comfyPath = findComfyUI()
          if (comfyPath) {
            console.log(`[ComfyUI] Auto-starting from: ${comfyPath}`)
            startComfy(comfyPath)
          } else {
            console.log('[ComfyUI] Not found. Set COMFYUI_PATH in .env or install ComfyUI.')
          }
        } else {
          console.log('[ComfyUI] Already running on port 8188')
        }
      })

      // Auto-stop ComfyUI when dev server closes
      server.httpServer?.on('close', stopComfy)
      process.on('exit', stopComfy)
      process.on('SIGINT', () => { stopComfy(); process.exit() })
      process.on('SIGTERM', () => { stopComfy(); process.exit() })

      // API: Manual start
      server.middlewares.use('/local-api/start-comfyui', async (_req, res) => {
        const alreadyRunning = await isComfyRunning()
        if (alreadyRunning) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'already_running' }))
          return
        }

        const comfyPath = findComfyUI()
        if (!comfyPath) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'not_found', message: 'ComfyUI not found. Set COMFYUI_PATH in .env file.' }))
          return
        }

        try {
          const result = startComfy(comfyPath)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'error', message: String(err) }))
        }
      })

      // API: Stop
      server.middlewares.use('/local-api/stop-comfyui', (_req, res) => {
        stopComfy()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'stopped' }))
      })

      // API: Status + logs
      server.middlewares.use('/local-api/comfyui-status', async (_req, res) => {
        const running = await isComfyRunning()
        const comfyPath = findComfyUI()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          running,
          starting: comfyProcess !== null && !running,
          found: comfyPath !== null,
          path: comfyPath,
          logs: comfyLogs.slice(-20),
        }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), comfyLauncher()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:11434',
        changeOrigin: true,
      },
      '/ollama-search': {
        target: 'https://ollama.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama-search/, '/search'),
      },
      '/comfyui': {
        target: 'http://localhost:8188',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/comfyui/, ''),
        ws: true,
      },
    },
  },
})
