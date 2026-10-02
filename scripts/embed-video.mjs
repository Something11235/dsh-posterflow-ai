/**
 * embed-video.mjs —— 把 assets/transition.webm 变成一个 data URI 模块，供 client 半边内联使用。
 *
 * 为什么要内联而不是让宿主走 HTTP 路由：
 * 本机实测发现桌面版 GUI（127.0.0.1:19387）**不是** `ctx.webServer` 的路由面——
 * 连内核自己的 `/plugins/...` 都返回 404，我注册的 `/posterflow-ai/*` 自然也拿不到。
 * 于是 client 半边取视频必然失败（video 触发 error → 立刻放行跳转），表现就是"完全没播"。
 * data URI 把视频带在产物里，不依赖任何协议、端口或路由，**一定能播**。
 *
 * 体积取舍：源视频 2.66 MiB，直接 base64 会变成 ~3.6 MB JS。这里先用 ffmpeg 压到 1080 宽 /
 * CRF 48 / 24fps（约 458 KB），base64 后约 611 KB，可接受。
 *
 * 用法：
 *   node scripts/embed-video.mjs           # 生成 src/generated/transition-video.ts
 *   node scripts/embed-video.mjs --check   # 只校验已生成的文件是否与 assets 一致（CI 用）
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve('.')
const source = path.join(root, 'assets/transition.webm')
const target = path.join(root, 'src/generated/transition-video.ts')
const checkOnly = process.argv.includes('--check')

if (!fs.existsSync(source)) {
  console.error(`缺少 ${path.relative(root, source)}——它是内联视频的源文件，不能丢`)
  process.exit(2)
}

const bytes = fs.readFileSync(source)
const base64 = bytes.toString('base64')
const dataUri = `data:video/webm;base64,${base64}`

// 切成多行字符串拼接：单个 600 KB 的字面量会让编辑器/检查器很难受
const CHUNK = 96
const chunks = []
for (let i = 0; i < dataUri.length; i += CHUNK) chunks.push(dataUri.slice(i, i + CHUNK))

const generated = `/**
 * 本文件由 scripts/embed-video.mjs 生成，**不要手改**。
 * 源文件：assets/transition.webm（${(bytes.length / 1024).toFixed(0)} KB）
 * 生成命令：node scripts/embed-video.mjs
 *
 * 内联而不是走宿主 HTTP 路由的原因见生成脚本头部注释。
 */
export const TRANSITION_VIDEO_BYTES = ${bytes.length}
export const TRANSITION_VIDEO_MIME = 'video/webm'
export const TRANSITION_VIDEO_DATA_URI = [
${chunks.map((chunk) => `  '${chunk}',`).join('\n')}
].join('')
`

if (checkOnly) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  if (current !== generated) {
    console.error('✗ src/generated/transition-video.ts 与 assets/transition.webm 不一致，请跑 node scripts/embed-video.mjs 并提交')
    process.exit(1)
  }
  console.log(`✓ 内联视频与 assets 一致（${(bytes.length / 1024).toFixed(0)} KB → data URI ${(dataUri.length / 1024).toFixed(0)} KB）`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, generated)
console.log(
  `✓ 已生成 ${path.relative(root, target)}：${(bytes.length / 1024).toFixed(0)} KB 视频 → ${(dataUri.length / 1024).toFixed(0)} KB data URI`,
)
