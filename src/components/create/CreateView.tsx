import { useEffect, useState, useCallback, useRef } from 'react'
import { Image, Video, WifiOff, Loader2, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import { useCreate } from '../../hooks/useCreate'
import { useCreateStore } from '../../stores/createStore'
import { PromptInput } from './PromptInput'
import { ParamPanel } from './ParamPanel'
import { OutputDisplay } from './OutputDisplay'
import { Gallery } from './Gallery'

interface ComfyStatus {
  running: boolean
  starting: boolean
  found: boolean
  path: string | null
  logs: string[]
}

export function CreateView() {
  const { connected, checkpoints, videoModels, samplerList, videoBackend, error, checkConnection, fetchModels, generate, cancel } = useCreate()
  const { mode, setMode } = useCreateStore()

  const [status, setStatus] = useState<ComfyStatus | null>(null)
  const [startupLogs, setStartupLogs] = useState<string[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Poll ComfyUI status with logs
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch('/local-api/comfyui-status')
      const data: ComfyStatus = await res.json()
      setStatus(data)
      if (data.logs.length > 0) setStartupLogs(data.logs)

      if (data.running) {
        const wasConnected = await checkConnection()
        if (wasConnected) fetchModels()
        return true
      }
    } catch { /* ignore */ }
    return false
  }, [checkConnection, fetchModels])

  // Initial check + auto-poll until connected
  useEffect(() => {
    let stopped = false

    const init = async () => {
      const ready = await pollStatus()
      if (ready || stopped) return

      // Keep polling every 3s while ComfyUI is starting
      pollRef.current = setInterval(async () => {
        if (stopped) return
        const ready = await pollStatus()
        if (ready && pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }, 3000)
    }
    init()

    return () => {
      stopped = true
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [pollStatus])

  const retryConnect = async () => {
    try { await fetch('/local-api/start-comfyui') } catch { /* ignore */ }
    // Start polling again
    if (!pollRef.current) {
      pollRef.current = setInterval(async () => {
        const ready = await pollStatus()
        if (ready && pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }, 3000)
    }
  }

  const isStarting = status?.starting || (status && !status.running && status.found)
  const notFound = status && !status.found && !status.running

  return (
    <div className="h-full flex flex-col">
      {/* Status: ComfyUI not found */}
      {notFound && (
        <div className="flex items-center justify-between px-4 py-3 bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/20">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
            <WifiOff size={16} />
            <span>ComfyUI not found. Install it or set COMFYUI_PATH in .env to enable image/video generation.</span>
          </div>
        </div>
      )}

      {/* Status: ComfyUI is starting */}
      {isStarting && !connected && (
        <div className="border-b border-yellow-200 dark:border-yellow-500/20">
          <div className="flex items-center gap-3 px-4 py-3 bg-yellow-50 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-sm">
            <Loader2 size={16} className="animate-spin shrink-0" />
            <span>ComfyUI is loading... This can take a minute on first start.</span>
          </div>
          {startupLogs.length > 0 && (
            <div className="px-4 py-2 bg-gray-900 text-gray-400 text-xs font-mono max-h-24 overflow-y-auto">
              {startupLogs.slice(-8).map((log, i) => (
                <div key={i} className="truncate">{log.trim()}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status: Not running but was found — offer retry */}
      {status && !status.running && status.found && !isStarting && !connected && (
        <div className="flex items-center justify-between px-4 py-3 bg-orange-50 dark:bg-orange-500/10 border-b border-orange-200 dark:border-orange-500/20">
          <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 text-sm">
            <AlertTriangle size={16} />
            <span>ComfyUI found but not responding. It may still be loading.</span>
          </div>
          <button
            onClick={retryConnect}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium transition-colors"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Status: Connected */}
      {connected === true && (
        <div className="flex items-center gap-2 px-4 py-2 bg-green-50 dark:bg-green-500/10 border-b border-green-200 dark:border-green-500/20 text-green-600 dark:text-green-400 text-sm">
          <CheckCircle size={16} />
          <span>ComfyUI connected — {checkpoints.length} image model{checkpoints.length !== 1 ? 's' : ''}, {videoModels.length} video model{videoModels.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
          {/* Mode switcher + Prompt */}
          <div className="space-y-3">
            <div className="flex gap-1 p-1 bg-gray-100 dark:bg-white/5 rounded-lg w-fit">
              <button
                onClick={() => setMode('image')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  mode === 'image' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <Image size={14} /> Image
              </button>
              <button
                onClick={() => setMode('video')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  mode === 'video' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <Video size={14} /> Video
              </button>
            </div>

            {mode === 'video' && videoBackend === 'none' && connected === true && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-xs">
                <AlertTriangle size={14} />
                <span>No video nodes detected. Install Wan 2.1 models or AnimateDiff in ComfyUI for video generation.</span>
              </div>
            )}

            {mode === 'video' && videoBackend !== 'none' && connected === true && (
              <div className="text-xs text-gray-400">
                Video backend: <span className="text-gray-300 font-medium">{videoBackend === 'wan' ? 'Wan 2.1/2.2' : 'AnimateDiff'}</span>
              </div>
            )}

            <PromptInput onGenerate={generate} onCancel={cancel} />

            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Output area */}
          <div className="flex-1 min-h-0 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1a1a1a] overflow-hidden flex flex-col">
            <OutputDisplay />
            <Gallery />
          </div>
        </div>

        {/* Parameter sidebar */}
        <div className="w-64 border-l border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-[#1a1a1a] p-4 overflow-y-auto scrollbar-thin hidden lg:block">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Parameters</h3>
          <ParamPanel checkpoints={checkpoints} videoModels={videoModels} samplerList={samplerList} />
        </div>
      </div>
    </div>
  )
}
