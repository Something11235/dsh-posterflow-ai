import { defineConfig } from 'tsdown'

/**
 * 两个入口，两种形态——这是双面插件的关键：
 *
 * 1. **宿主半边** `src/index.ts` → `lib/index.js`（ESM，`@deepseek-ai/*` 全部外置）。
 *    运行时由 DSH 自己的加载闭包提供内核包；打进去会出现两份 cordis 实例。
 *
 * 2. **浏览器半边** `src/client.ts` → `lib/client.js`。
 *    产物必须是**普通脚本**（`window.__ModuleLoader__.load({id, factory})` 包裹的惰性 CJS），
 *    不能被包成 ESM/CJS 模块——外壳是用 `<script>` 直接加载它的。
 *    `src/client.ts` 里刻意没有任何 import：唯一的 React 来自注入的 `require`。
 */
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: 'lib',
    // 默认在 node 平台会输出 .mjs/.d.mts；固定成 .js/.d.ts 以对齐 package.json。
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    dts: true,
    clean: true,
    sourcemap: true,
    deps: {
      neverBundle: [/^@deepseek-ai\//],
    },
  },
  {
    // 产物固定为 lib/client.js —— package.json 的 exports["./client"] 指向它
    entry: { client: 'src/client.ts' },
    // iife：产物必须是外壳能直接 <script> 加载的普通脚本，不能出现 exports/module 引用。
    // （源码里的 `export {}` 只为满足 isolatedModules，是类型层导出，不会产生运行时引用。）
    format: ['iife'],
    platform: 'browser',
    outDir: 'lib',
    // 固定产物名：IIFE 格式默认会输出 client.iife.js，而 exports["./client"] 指向 client.js。
    outputOptions: { entryFileNames: 'client.js' },
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    // 不要 clean：否则会把上一段构建出的宿主半边产物删掉
    clean: false,
    sourcemap: true,
  },
])
