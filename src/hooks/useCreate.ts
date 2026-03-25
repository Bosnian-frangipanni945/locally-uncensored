import { useState, useCallback, useRef } from 'react'
import { v4 as uuid } from 'uuid'
import {
  checkComfyConnection,
  getCheckpoints,
  getDiffusionModels,
  getSamplers,
  detectVideoBackend,
  submitWorkflow,
  getHistory,
  buildTxt2ImgWorkflow,
  buildTxt2VidWorkflow,
  type ComfyUIOutput,
  type VideoBackend,
} from '../api/comfyui'
import { useCreateStore, type GalleryItem } from '../stores/createStore'

export function useCreate() {
  const store = useCreateStore()
  const [connected, setConnected] = useState<boolean | null>(null)
  const [checkpoints, setCheckpoints] = useState<string[]>([])
  const [videoModels, setVideoModels] = useState<string[]>([])
  const [samplerList, setSamplerList] = useState<string[]>([])
  const [videoBackend, setVideoBackend] = useState<VideoBackend>('none')
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const checkConnection = useCallback(async () => {
    const ok = await checkComfyConnection()
    setConnected(ok)
    return ok
  }, [])

  const fetchModels = useCallback(async () => {
    const [ckpts, diffModels, samplers, vBackend] = await Promise.all([
      getCheckpoints(),
      getDiffusionModels(),
      getSamplers(),
      detectVideoBackend(),
    ])
    setCheckpoints(ckpts)
    setVideoModels(diffModels)
    setSamplerList(samplers)
    setVideoBackend(vBackend)

    if (ckpts.length > 0 && !store.model) {
      store.setModel(ckpts[0])
    }
  }, [store])

  const generate = useCallback(async () => {
    const {
      mode, prompt, negativePrompt, model, sampler, steps, cfgScale,
      width, height, seed, frames, fps,
      setIsGenerating, setProgress, setCurrentPromptId, addToGallery,
    } = useCreateStore.getState()

    setError(null)

    if (!prompt.trim()) {
      setError('Please enter a prompt.')
      return
    }
    if (!model) {
      setError('No model selected. Make sure ComfyUI has models installed.')
      return
    }

    // Check ComfyUI is actually running
    const isRunning = await checkComfyConnection()
    if (!isRunning) {
      setError('ComfyUI is not running. Wait for it to start or check the connection.')
      return
    }

    setIsGenerating(true)
    setProgress(0)

    try {
      const workflow = mode === 'video'
        ? buildTxt2VidWorkflow({ prompt, negativePrompt, model, sampler, steps, cfgScale, width, height, seed, frames, fps }, videoBackend)
        : buildTxt2ImgWorkflow({ prompt, negativePrompt, model, sampler, steps, cfgScale, width, height, seed })

      let promptId: string
      try {
        promptId = await submitWorkflow(workflow)
      } catch (err) {
        setError(`Failed to submit to ComfyUI: ${err instanceof Error ? err.message : String(err)}`)
        setIsGenerating(false)
        return
      }
      setCurrentPromptId(promptId)

      // Poll for completion
      await new Promise<void>((resolve, reject) => {
        let attempts = 0
        const maxAttempts = 1200

        pollRef.current = setInterval(async () => {
          attempts++
          if (attempts > maxAttempts) {
            clearInterval(pollRef.current!)
            reject(new Error('Generation timed out after 20 minutes'))
            return
          }

          try {
            const history = await getHistory(promptId)
            if (!history) {
              setProgress(Math.min(attempts / (steps * 2) * 100, 95))
              return
            }

            if (history.status?.completed) {
              clearInterval(pollRef.current!)
              setProgress(100)

              const outputs = history.outputs || {}
              let found = false
              for (const nodeId of Object.keys(outputs)) {
                const nodeOutput = outputs[nodeId]
                const files: ComfyUIOutput[] = [
                  ...(nodeOutput.images || []),
                  ...(nodeOutput.gifs || []),
                  ...(nodeOutput.videos || []),
                ]
                for (const file of files) {
                  found = true
                  const galleryItem: GalleryItem = {
                    id: uuid(),
                    type: mode,
                    filename: file.filename,
                    subfolder: file.subfolder || '',
                    prompt,
                    negativePrompt,
                    model,
                    seed: seed === -1 ? 0 : seed,
                    steps,
                    cfgScale,
                    width,
                    height,
                    createdAt: Date.now(),
                  }
                  addToGallery(galleryItem)
                }
              }
              if (!found) {
                setError('Generation completed but no output was produced. Check ComfyUI logs.')
              }
              resolve()
            } else if (history.status?.status_str === 'error') {
              clearInterval(pollRef.current!)
              const errMsg = history.status?.messages?.[0]?.[1]?.message || 'Unknown error in ComfyUI'
              reject(new Error(errMsg))
            }
          } catch {
            // Keep polling on network errors
          }
        }, 1000)
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Generation failed: ${msg}`)
      console.error('Generation error:', err)
    } finally {
      setIsGenerating(false)
      setProgress(0)
      setCurrentPromptId(null)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [videoBackend])

  const cancel = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
    }
    store.setIsGenerating(false)
    store.setProgress(0)
    store.setCurrentPromptId(null)
    setError(null)
  }, [store])

  return {
    connected,
    checkpoints,
    videoModels,
    samplerList,
    videoBackend,
    error,
    checkConnection,
    fetchModels,
    generate,
    cancel,
  }
}
