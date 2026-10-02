/**
 * 真实组合测试：挂载**真正的 WebServer 服务**，再挂上本插件，然后用真的 HTTP 请求
 * 打它注册的路由。
 *
 * 为什么值得这么做：路由是本插件唯一"会往网络上说话"的部分——Range 语义、416、
 * HEAD、路径逃逸防护，全都只有发真请求才能验证。这里只用 OS 分配的临时回环端口
 * （`port: 0`），测试结束即释放，不影响任何正在运行的服务。
 */
import { readFileSync } from 'node:fs'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { apply, CONFIG_ROUTE, inject, name, VIDEO_ROUTE, type Config } from '../src/index.js'
import { fileURLToPath } from 'node:url'

const VIDEO_PATH = fileURLToPath(new URL('../assets/transition.webm', import.meta.url))
const VIDEO_SIZE = readFileSync(VIDEO_PATH).byteLength
/** WebM/Matroska 的 EBML 魔数：真视频的头 4 个字节一定长这样。 */
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3]

let fibers: Fiber[] = []
let origin = ''

const baseConfig: Config = {
  targetUrl: 'https://www.posterflow-ai.xyz/',
  buttonLabel: '开启生图模式',
  openIn: 'new-tab',
  transition: 'video',
  videoFile: 'assets/transition.webm',
  muted: true,
  maxWaitMs: 8000,
}

async function mount(config: Config): Promise<Context> {
  const local = new Context()
  const server = await local.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const plugin = await local.plugin({ name, inject, apply }, config)
  fibers = [server, plugin]
  const port = (local.webServer as unknown as { port: number }).port
  origin = `http://127.0.0.1:${port}`
  return local
}

beforeEach(async () => {
  await mount(baseConfig)
})

afterEach(async () => {
  for (const fiber of [...fibers].reverse()) await fiber.dispose()
  fibers = []
})

describe('真实 WebServer 上的路由', () => {
  it('配置路由返回部署期配置（client 半边就是靠它拿到 targetUrl）', async () => {
    const response = await fetch(`${origin}${CONFIG_ROUTE}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload.targetUrl).toBe('https://www.posterflow-ai.xyz/')
    expect(payload.buttonLabel).toBe('开启生图模式')
    expect(payload.openIn).toBe('new-tab')
    expect(payload.videoUrl).toBe(VIDEO_ROUTE)
  })

  it('视频路由返回完整视频，且内容真的是 WebM', async () => {
    const response = await fetch(`${origin}${VIDEO_ROUTE}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/webm')
    expect(Number(response.headers.get('content-length'))).toBe(VIDEO_SIZE)
    expect(response.headers.get('accept-ranges')).toBe('bytes')

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(bytes.byteLength).toBe(VIDEO_SIZE)
    expect(Array.from(bytes.subarray(0, 4))).toEqual(EBML_MAGIC)
  })

  it('Range 请求返回 206 与正确的 Content-Range（视频 seek 依赖它）', async () => {
    const response = await fetch(`${origin}${VIDEO_ROUTE}`, { headers: { range: 'bytes=0-3' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes 0-3/${VIDEO_SIZE}`)
    expect(Number(response.headers.get('content-length'))).toBe(4)
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect(Array.from(bytes)).toEqual(EBML_MAGIC)
  })

  it('越界 Range 返回 416 并带 Content-Range: bytes */size', async () => {
    const response = await fetch(`${origin}${VIDEO_ROUTE}`, { headers: { range: `bytes=${VIDEO_SIZE + 10}-` } })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe(`bytes */${VIDEO_SIZE}`)
  })

  it('HEAD 请求只回头部不回正文', async () => {
    const response = await fetch(`${origin}${VIDEO_ROUTE}`, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(Number(response.headers.get('content-length'))).toBe(VIDEO_SIZE)
    expect((await response.arrayBuffer()).byteLength).toBe(0)
  })

  it('卸载插件后路由立刻消失（可逆 effect）', async () => {
    await fibers.at(-1)?.dispose()
    const response = await fetch(`${origin}${CONFIG_ROUTE}`)
    // 没有其它路由接管 → 由 webServer 的默认 fallback 回 404
    expect(response.status).toBe(404)
  })
})

describe('配置边界', () => {
  it('transition: none 时不注册视频路由，但配置路由仍然可用', async () => {
    await mount({ ...baseConfig, transition: 'none' })
    expect((await fetch(`${origin}${CONFIG_ROUTE}`)).status).toBe(200)
    expect((await fetch(`${origin}${VIDEO_ROUTE}`)).status).toBe(404)
  })

  it('videoFile 试图逃出包目录时不注册视频路由（拒绝，而不是去读那个文件）', async () => {
    await mount({ ...baseConfig, videoFile: '../../../.credentials.yaml' })
    expect((await fetch(`${origin}${VIDEO_ROUTE}`)).status).toBe(404)
    // 配置路由照常工作
    expect((await fetch(`${origin}${CONFIG_ROUTE}`)).status).toBe(200)
  })

  it('自定义 targetUrl / openIn 会透传给客户端载荷', async () => {
    await mount({ ...baseConfig, targetUrl: 'https://example.test/x', openIn: 'same-tab', buttonLabel: 'Go' })
    const payload = (await (await fetch(`${origin}${CONFIG_ROUTE}`)).json()) as Record<string, unknown>
    expect(payload.targetUrl).toBe('https://example.test/x')
    expect(payload.openIn).toBe('same-tab')
    expect(payload.buttonLabel).toBe('Go')
  })
})
