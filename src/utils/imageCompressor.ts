export interface CompressionResult {
  dataUrl: string
  originalSize: number
  compressedSize: number
  width: number
  height: number
  compressed: boolean
}

export interface CompressOptions {
  maxDimension?: number
  quality?: number
  maxFileSize?: number
  fastPathThreshold?: number
}

export const MAX_IMAGE_FILE_SIZE = 15 * 1024 * 1024 // 15 Megabytes

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('READ_FAILED'))
    reader.readAsDataURL(file)
  })
}

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<CompressionResult> {
  const maxDimension = options.maxDimension ?? 1280
  const quality = Math.min(Math.max(options.quality ?? 0.8, 0.1), 1.0)
  const maxFileSize = options.maxFileSize ?? MAX_IMAGE_FILE_SIZE
  const fastPathThreshold = options.fastPathThreshold ?? 200 * 1024

  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error('INVALID_IMAGE_TYPE')
  }

  if (file.size > maxFileSize) {
    throw new Error('FILE_TOO_LARGE')
  }

  // Load image to determine native dimensions
  let objectUrl: string | null = null
  let img: HTMLImageElement

  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        objectUrl = URL.createObjectURL(file)
        image.src = objectUrl
      } else {
        // Fallback for environments without URL.createObjectURL
        readFileAsDataUrl(file).then((data) => {
          image.src = data
        }).catch(reject)
      }

      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'))
    })
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl)
      } catch {
        // Ignore revoke errors
      }
    }
  }

  const nativeWidth = img.naturalWidth || img.width
  const nativeHeight = img.naturalHeight || img.height

  // Fast path: if the file is already under fastPathThreshold and within max dimension,
  // preserve the original bytes and format without any lossy re-encoding.
  if (
    file.size <= fastPathThreshold &&
    nativeWidth <= maxDimension &&
    nativeHeight <= maxDimension
  ) {
    const dataUrl = await readFileAsDataUrl(file)
    return {
      dataUrl,
      originalSize: file.size,
      compressedSize: file.size,
      width: nativeWidth,
      height: nativeHeight,
      compressed: false,
    }
  }

  // Calculate target bounding box preserving aspect ratio
  let targetWidth = nativeWidth
  let targetHeight = nativeHeight

  if (targetWidth > maxDimension || targetHeight > maxDimension) {
    if (targetWidth >= targetHeight) {
      targetHeight = Math.round((targetHeight * maxDimension) / targetWidth)
      targetWidth = maxDimension
    } else {
      targetWidth = Math.round((targetWidth * maxDimension) / targetHeight)
      targetHeight = maxDimension
    }
  }

  targetWidth = Math.max(1, targetWidth)
  targetHeight = Math.max(1, targetHeight)

  // Use HTML5 Canvas to resize and compress
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    // If canvas context cannot be acquired, fallback to raw reader
    const dataUrl = await readFileAsDataUrl(file)
    return {
      dataUrl,
      originalSize: file.size,
      compressedSize: file.size,
      width: nativeWidth,
      height: nativeHeight,
      compressed: false,
    }
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight)

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const base64Index = dataUrl.indexOf(',')
  const base64Data = base64Index >= 0 ? dataUrl.slice(base64Index + 1) : dataUrl
  const compressedSize = Math.round(base64Data.length * 0.75)

  // If the compressed output is somehow larger than the original (and original was already small),
  // retain original file
  if (compressedSize >= file.size && file.size <= fastPathThreshold * 2) {
    const originalDataUrl = await readFileAsDataUrl(file)
    return {
      dataUrl: originalDataUrl,
      originalSize: file.size,
      compressedSize: file.size,
      width: nativeWidth,
      height: nativeHeight,
      compressed: false,
    }
  }

  return {
    dataUrl,
    originalSize: file.size,
    compressedSize,
    width: targetWidth,
    height: targetHeight,
    compressed: true,
  }
}
