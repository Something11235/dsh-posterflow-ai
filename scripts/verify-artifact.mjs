/**
 * 校验「真正被 DSH 加载的那份产物」——lib/index.js（宿主半边）。
 *
 * tests/webserver.test.ts 测的是 src/ 的 TypeScript；DSH 加载的是构建产物，
 * 中间隔着打包器（外置依赖、格式、扩展名）。这里把产物本身挂到真 cordis Context +
 * 真 WebServer 上，并打一个真 HTTP 请求，确认路由确实由产物注册成功。
 *
 * 用法：先 pnpm run build，再 pnpm run test:artifact
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'

const artifact = await import('../lib/index.js')

// ① 产物必须导出 DSH 约定的元数据
assert.equal(typeof artifact.apply, 'function', 'lib/index.js must export apply()')
assert.equal(artifact.name, 'posterflow-ai', 'lib/index.js must export name')
assert.deepEqual(artifact.inject, [], 'lib/index.js must export inject')
assert.equal(typeof artifact.Config, 'function', 'lib/index.js must export the Config schema')
assert.equal(artifact.CONFIG_ROUTE, '/posterflow-ai/config.json', 'CONFIG_ROUTE must be exported')
assert.equal(artifact.VIDEO_ROUTE, '/posterflow-ai/transition.webm', 'VIDEO_ROUTE must be exported')

// ② 运行时会用到的内核包必须保持外置（这次没有运行时内核依赖，但仍要防止被打进来）
const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
assert.ok(source.length < 40_000, 'bundle looks inlined — check tsdown deps.neverBundle')
assert.ok(!/@deepseek-ai\/dsh-host-webserver/u.test(source) || !/class WebServer/u.test(source), 'webserver must not be inlined')

// ③ 挂到真实 Context + 真实 WebServer（OS 分配端口），打真请求
const ctx = new Context()
const fibers = [await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })]
fibers.push(
  await ctx.plugin(
    { name: artifact.name, inject: artifact.inject, apply: artifact.apply },
    {
      targetUrl: 'https://www.posterflow-ai.xyz/',
      buttonLabel: '开启生图模式',
      openIn: 'new-tab',
      transition: 'video',
      videoFile: 'assets/transition.webm',
      muted: true,
      maxWaitMs: 8000,
    },
  ),
)

try {
  const port = ctx.webServer.port
  const origin = `http://127.0.0.1:${port}`

  const configResponse = await fetch(`${origin}${artifact.CONFIG_ROUTE}`)
  assert.equal(configResponse.status, 200, 'config route must answer 200')
  const payload = await configResponse.json()
  assert.equal(payload.targetUrl, 'https://www.posterflow-ai.xyz/')
  assert.equal(payload.videoUrl, artifact.VIDEO_ROUTE)

  const videoResponse = await fetch(`${origin}${artifact.VIDEO_ROUTE}`, { headers: { range: 'bytes=0-3' } })
  assert.equal(videoResponse.status, 206, 'range request must answer 206')
  const head = new Uint8Array(await videoResponse.arrayBuffer())
  assert.deepEqual([...head], [0x1a, 0x45, 0xdf, 0xa3], 'first bytes must be the WebM/EBML magic')

  // ④ 卸载后路由必须消失（可逆 effect）
  await fibers.at(-1).dispose()
  const gone = await fetch(`${origin}${artifact.CONFIG_ROUTE}`)
  assert.equal(gone.status, 404, 'disposing the fiber must remove the routes')
} finally {
  for (const fiber of [...fibers].reverse()) await fiber.dispose()
}

console.log('✓ lib/index.js: exports ok, kernel deps external, routes served on a real WebServer, removed on dispose')
