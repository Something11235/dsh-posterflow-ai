/**
 * client 半边入口 —— 惰性 CJS 表。
 *
 * 这个文件刻意保持极薄：它只做三件事——
 *   ① 声明 `window.__ModuleLoader__`；
 *   ② 注册工厂（此时**不**执行任何模块体副作用）；
 *   ③ 在 factory 里从注入的 `require` 取 `react`，把实现交给 `./panels.js`。
 *
 * 实现放在 `panels.js` 里是为了可测试：脚本形态的文件没法被单测导入。
 * 相对导入会在构建时被 inline 进 `lib/client.js`，因此产物仍然**零 npm 依赖**，
 * 是外壳可以直接 `<script>` 加载的普通脚本（由 scripts/verify-client-bundle.mjs 把关）。
 */
import { createPanelPlugin, type ReactLike } from './panels.js'

interface ClientBundleRegistration {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

declare const window: {
  __ModuleLoader__: { load(registration: ClientBundleRegistration): void }
}

window.__ModuleLoader__.load({
  id: 'dsh-posterflow-ai',
  factory: (require) => {
    const React = require('react') as ReactLike
    const plugin = createPanelPlugin(React)
    return { name: plugin.name, inject: plugin.inject, apply: plugin.apply }
  },
})
