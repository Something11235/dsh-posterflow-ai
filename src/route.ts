/**
 * 纯逻辑：路由相关的辅助函数与路径安全。
 *
 * 单独成文件的原因：这些是唯一"值得单测"的部分（Range 解析、内容类型、路径逃逸防护），
 * 而且它们不 import 任何 DSH 包，可以脱离宿主跑。
 */
import path from 'node:path'

/** 解析后的字节区间（闭区间）。 */
export interface ParsedRange {
  start: number
  end: number
}

/** 传给 client 半边的运行时配置（由宿主路由以 JSON 提供）。 */
export interface ClientConfig {
  /** 过场结束后要跳转的地址。 */
  targetUrl: string
  /** 按钮文案。 */
  buttonLabel: string
  /** 跳转方式。 */
  openIn: 'new-tab' | 'same-tab'
  /** 是否播放过场视频。 */
  transition: 'video' | 'none'
  /** 过场视频地址（由宿主提供的路由）。 */
  videoUrl: string
  /** 视频是否静音（静音才能保证自动播放不被浏览器策略拦下）。 */
  muted: boolean
  /** 视频最长等待时间，超时直接跳转（毫秒）。 */
  maxWaitMs: number
}

/**
 * 解析 HTTP `Range` 头。
 *
 * 视频播放器（尤其 Chromium）会发 `Range: bytes=0-` 探路，seek 时会发具体区间；
 * 不支持 Range 的服务器仍能播，但 seek/续播行为会退化，所以这里实现最小可用子集。
 *
 * @param header - `Range` 头原文，可能为空。
 * @param size - 资源总字节数。
 * @returns 需要返回的闭区间；`null` 表示"按整份返回"；`'unsatisfiable'` 表示 416。
 */
export function parseRange(header: string | undefined, size: number): ParsedRange | 'unsatisfiable' | null {
  if (header === undefined || header === '') return null
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim())
  if (match === null) return null
  const rawStart = match[1] ?? ''
  const rawEnd = match[2] ?? ''
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number
  if (rawStart === '') {
    // 后缀区间：最后 N 字节
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (size <= 0) return 'unsatisfiable'
  if (start > end || start >= size) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

const CONTENT_TYPES: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.json': 'application/json; charset=utf-8',
}

/**
 * 按扩展名给出 Content-Type；未知类型回落 `application/octet-stream`。
 * @param fileName - 文件名或路径。
 * @returns MIME 类型。
 */
export function contentTypeFor(fileName: string): string {
  return CONTENT_TYPES[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 把包内相对路径解析成绝对路径，并**保证它没有逃出包目录**。
 *
 * 为什么必须做这件事：`videoFile` 来自 patch 层的配置。如果直接 `path.join(root, videoFile)`，
 * 一份写着 `../../../../.credentials.yaml` 的配置就能让插件把宿主的凭据文件当视频发出去。
 * 配置是"可信的部署输入"，但一个会读文件的插件不该给配置留这种口子。
 *
 * @param packageRoot - 包根目录的绝对路径。
 * @param relativePath - 包内相对路径。
 * @returns 绝对路径。
 * @throws 当目标逃出包根目录时。
 */
export function resolveInsidePackage(packageRoot: string, relativePath: string): string {
  const root = path.resolve(packageRoot)
  const target = path.resolve(root, relativePath)
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`videoFile escapes the package directory: ${relativePath}`)
  }
  return target
}

/**
 * 组装给 client 半边的配置载荷。
 * @param config - 宿主侧已校验的配置。
 * @param videoUrl - 宿主实际注册的视频路由地址。
 * @returns 可 JSON 序列化的载荷。
 */
export function buildClientConfig(
  config: {
    targetUrl: string
    buttonLabel: string
    openIn: 'new-tab' | 'same-tab'
    transition: 'video' | 'none'
    muted: boolean
    maxWaitMs: number
  },
  videoUrl: string,
): ClientConfig {
  return {
    targetUrl: config.targetUrl,
    buttonLabel: config.buttonLabel,
    openIn: config.openIn,
    transition: config.transition,
    videoUrl,
    muted: config.muted,
    maxWaitMs: config.maxWaitMs,
  }
}
