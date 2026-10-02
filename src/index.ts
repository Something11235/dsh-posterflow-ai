/**
 * dsh-posterflow-ai —— 网站跳转插件（宿主半边）。
 *
 * 流程：用户在 Web 界面点「开启生图模式」→ 播放过场视频 → 跳转到 PosterFlow。
 *
 * 宿主半边只做两件事：
 *   ① 把过场视频按 HTTP 路由提供给浏览器（视频 2.66 MiB，内联进 client bundle 会变成
 *      3.6 MB 的 JS，所以走路由按需传输）；
 *   ② 把部署期配置以 JSON 路由暴露给 client 半边（client 半边读不到宿主的 Config）。
 *
 * 设计取舍：**不 inject `webServer`**。这个插件是给 Web 界面用的，但用 `ctx.get('webServer')`
 * 读取并降级，可以让它在 headless 之类的 profile 里也能正常加载（只是不提供路由），
 * 而不是因为依赖缺失一直等在那里。
 */
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { fileURLToPath } from 'node:url'

import { buildClientConfig, contentTypeFor, parseRange, resolveInsidePackage } from './route.js'

/** 诊断信息里的插件名。 */
export const name = 'posterflow-ai'

/** 没有必需服务：`webServer` 是可选能力，用 `ctx.get` 读取。 */
export const inject: string[] = []

/** 路由前缀，与 client 半边里的地址保持一致。 */
export const ROUTE_PREFIX = '/posterflow-ai'
/** 过场视频的路由。 */
export const VIDEO_ROUTE = `${ROUTE_PREFIX}/transition.webm`
/** 运行时配置的路由。 */
export const CONFIG_ROUTE = `${ROUTE_PREFIX}/config.json`
/** 侧栏主列表那一行的 id，同时也是 `main` 面板的 key。 */
export const PANEL_ID = 'posterflow-ai'
/** 侧栏主列表（「插件」「自动化任务」所在的那一列）。 */
export const SLOT_PANEL_LIST = 'sidebar.panellist'
/** 主面板 keyed 槽，承载过场与跳转。 */
export const SLOT_MAIN = 'main'
/** 排在最后一行：既有的 plugins = 0、schedules = 10。 */
export const PANEL_ORDER = 100

/** 部署期配置。 */
export interface Config {
  /** 过场结束后跳转的地址。 */
  targetUrl: string
  /**
   * 视频来源。
   * `inline`（默认）= 用产物里内联的视频，不依赖端口/路由，**一定能播**；
   * `route` = 用宿主注册的 HTTP 路由（只有在页面确实由 `ctx.webServer` 提供服务时才有效）。
   */
  videoSource: 'inline' | 'route'
  /** 按钮文案。 */
  buttonLabel: string
  /** 跳转方式：新标签页（默认，不会丢掉当前会话界面）或当前标签页。 */
  openIn: 'new-tab' | 'same-tab'
  /** 是否播放过场视频；设为 `none` 则点击后直接跳转。 */
  transition: 'video' | 'none'
  /** 过场视频在包内的相对路径。 */
  videoFile: string
  /**
   * 过场视频是否静音。默认 `false`（有声音）；被浏览器自动播放策略拒绝时会自动降级为静音，
   * 并在画面右上角给出「开启声音」按钮。
   */
  muted: boolean
  /** 视频最长等待时间（毫秒），超时直接跳转，避免用户被卡在过场里。 */
  maxWaitMs: number
}

/** Config 的运行时校验 schema。 */
export const Config: z<Config> = z.object({
  targetUrl: z.string().default('https://www.posterflow-ai.xyz/'),
  videoSource: z.union([z.const('inline'), z.const('route')]).default('inline'),
  buttonLabel: z.string().default('开启生图模式'),
  openIn: z.union([z.const('new-tab'), z.const('same-tab')]).default('new-tab'),
  transition: z.union([z.const('video'), z.const('none')]).default('video'),
  videoFile: z.string().default('assets/transition.webm'),
  muted: z.boolean().default(false),
  maxWaitMs: z.number().step(1).min(0).max(60_000).default(8000),
})

/**
 * 把视频按 Range 语义发给浏览器。响应由本函数完全接管。
 * @param req - 入站请求（读 `Range` 头与 method）。
 * @param res - 响应对象。
 * @param filePath - 视频文件的绝对路径。
 */
function serveVideo(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  let size: number
  try {
    size = fs.statSync(filePath).size
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`transition video not found: ${filePath}`)
    return
  }

  const type = contentTypeFor(filePath)
  const range = parseRange(req.headers.range, size)

  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' })
    res.end()
    return
  }

  const headers: Record<string, string | number> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  }

  if (range) {
    headers['Content-Length'] = range.end - range.start + 1
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
    res.writeHead(206, headers)
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end })
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    return
  }

  headers['Content-Length'] = size
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = fs.createReadStream(filePath)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

/**
 * 插件主体。
 * @param ctx - 插件上下文。
 * @param config - 已按 {@link Config} 校验过的配置。
 */
export function apply(ctx: Context, config: Config): void {
  // lib/index.js → 包根目录
  const packageRoot = fileURLToPath(new URL('..', import.meta.url))

  let videoPath: string | undefined
  if (config.transition === 'video') {
    try {
      videoPath = resolveInsidePackage(packageRoot, config.videoFile)
    } catch (error) {
      ctx.logger.warn(`[${name}] ${(error as Error).message}；过场视频已禁用`)
    }
  }

  const webServer = ctx.get('webServer') as WebServer | undefined
  if (webServer === undefined) {
    ctx.logger.info(`[${name}] 当前 profile 没有 webServer，界面入口不可用（浏览器半边只存在于 Web 界面）`)
    return
  }

  // ① 配置路由：client 半边读不到宿主的 Config，所以用一条路由把它递过去。
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: CONFIG_ROUTE,
      handler: (_req, res) => {
        const body = JSON.stringify(buildClientConfig(config, VIDEO_ROUTE))
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
        })
        res.end(body)
      },
    }),
  )

  // ② 视频路由：按需传输，带 Range 支持。
  if (videoPath !== undefined) {
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: VIDEO_ROUTE,
        handler: (req, res) => serveVideo(req, res, videoPath),
      }),
    )
  }

  ctx.logger.info(
    `[${name}] 已就绪：按钮「${config.buttonLabel}」→ ${config.openIn === 'new-tab' ? '新标签页打开' : '当前页跳转'} ${config.targetUrl}` +
      (videoPath === undefined ? '（无过场视频）' : `（过场视频 ${VIDEO_ROUTE}）`),
  )
}
