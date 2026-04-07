import { classifyModel, findMatchingVAE, findMatchingCLIP, type ModelType } from './comfyui'
import { getAllNodeInfo, categorizeNodes, type CategorizedNodes } from './comfyui-nodes'
import { COMPONENT_REGISTRY } from './discover'

// ─── Pre-Flight Validation ───
// Checks everything BEFORE generation so users get instant feedback on model readiness.

export interface PreflightWarning {
  type: 'unknown_model' | 'size_alignment' | 'high_vram'
  message: string
}

export interface PreflightError {
  type: 'missing_vae' | 'missing_clip' | 'missing_nodes' | 'no_model'
  message: string
  downloadUrl?: string
  downloadFilename?: string
  downloadSubfolder?: string
}

export interface PreflightResult {
  ready: boolean
  modelType: ModelType
  warnings: PreflightWarning[]
  errors: PreflightError[]
  resolvedVAE?: string
  resolvedCLIP?: string
}

export async function preflightCheck(
  modelName: string,
  mode: 'image' | 'video',
  width?: number,
  height?: number,
): Promise<PreflightResult> {
  const warnings: PreflightWarning[] = []
  const errors: PreflightError[] = []
  let resolvedVAE: string | undefined
  let resolvedCLIP: string | undefined

  if (!modelName) {
    return { ready: false, modelType: 'unknown', warnings, errors: [{ type: 'no_model', message: 'No model selected.' }] }
  }

  const modelType = classifyModel(modelName)
  const registry = COMPONENT_REGISTRY[modelType]

  // Warn on unknown model type
  if (modelType === 'unknown') {
    warnings.push({
      type: 'unknown_model',
      message: `Model type not recognized. Using SDXL defaults. Rename the file to include the model type (e.g. "sdxl", "flux", "sd15") for optimal settings.`,
    })
  }

  // Check required nodes
  let nodes: CategorizedNodes | null = null
  try {
    const allNodes = await getAllNodeInfo()
    nodes = categorizeNodes(allNodes)
  } catch {
    return { ready: false, modelType, warnings, errors: [{ type: 'missing_nodes', message: 'Cannot reach ComfyUI to verify nodes.' }] }
  }

  const needsUnet = modelType === 'flux' || modelType === 'flux2' || modelType === 'wan' || modelType === 'hunyuan'
    || modelType === 'ltx' || modelType === 'mochi' || modelType === 'cosmos' || modelType === 'cogvideo'
    || modelType === 'framepack' || modelType === 'pyramidflow' || modelType === 'allegro'
  if (needsUnet) {
    const hasUNET = nodes.loaders.includes('UNETLoader')
    const hasCLIPLoader = nodes.loaders.includes('CLIPLoader')
    const hasVAELoader = nodes.loaders.includes('VAELoader')
    if (!hasUNET || !hasCLIPLoader || !hasVAELoader) {
      const missing = [!hasUNET && 'UNETLoader', !hasCLIPLoader && 'CLIPLoader', !hasVAELoader && 'VAELoader'].filter(Boolean)
      errors.push({
        type: 'missing_nodes',
        message: `Missing required nodes: ${missing.join(', ')}. Update ComfyUI to the latest version.`,
      })
    }
  } else {
    if (!nodes.loaders.includes('CheckpointLoaderSimple')) {
      errors.push({
        type: 'missing_nodes',
        message: 'Missing CheckpointLoaderSimple node. Update ComfyUI.',
      })
    }
  }

  // Check VAE availability (only for UNET-based models — checkpoints include VAE)
  if (needsUnet) {
    try {
      resolvedVAE = await findMatchingVAE(modelType)
    } catch (err) {
      const vaeSpec = registry?.vae
      errors.push({
        type: 'missing_vae',
        message: err instanceof Error ? err.message : 'VAE not found.',
        downloadUrl: vaeSpec?.downloadUrl,
        downloadFilename: vaeSpec?.downloadName,
        downloadSubfolder: vaeSpec?.subfolder,
      })
    }
  }

  // Check CLIP/text encoder availability (only for UNET-based models)
  if (needsUnet) {
    try {
      resolvedCLIP = await findMatchingCLIP(modelType)
    } catch (err) {
      const clipSpec = registry?.clip
      errors.push({
        type: 'missing_clip',
        message: err instanceof Error ? err.message : 'Text encoder not found.',
        downloadUrl: clipSpec?.downloadUrl,
        downloadFilename: clipSpec?.downloadName,
        downloadSubfolder: clipSpec?.subfolder,
      })
    }
  }

  // Size alignment check for video
  if (mode === 'video' && width && height) {
    if (width % 16 !== 0 || height % 16 !== 0) {
      warnings.push({
        type: 'size_alignment',
        message: `Video dimensions must be multiples of 16. Current: ${width}x${height}.`,
      })
    }
  }

  return {
    ready: errors.length === 0,
    modelType,
    warnings,
    errors,
    resolvedVAE,
    resolvedCLIP,
  }
}
