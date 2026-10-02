/**
 * verify-client-bundle.mjs —— 验证 client 半边产物符合「惰性 CJS 表」契约。
 *
 * 判定手法（不需要浏览器）：注入假的 `window.__ModuleLoader__`（只记录 load()）与假的
 * `require`（记录每次模块请求），在 Node 里直接求值 `lib/client.js`。
 * 硬证据是：**模块体里第一件事就是 `require('react')`，所以只要执行期出现过任何模块请求，
 * 就说明模块体被 materialize 了**——那就违反了惰性契约。
 *
 * 用法：node scripts/verify-client-bundle.mjs [lib/client.js]
 * 退出码 0 = 契约成立。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const file = path.resolve(process.argv[2] ?? 'lib/client.js')
if (!fs.existsSync(file)) {
  console.error(`missing ${file} — 先跑 pnpm run build`)
  process.exit(2)
}
const source = fs.readFileSync(file, 'utf8')
const expectedId = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).name

const registrations = []
const requireCalls = []
let domMutations = 0

const makeElement = (tag = 'div') => ({
  tagName: String(tag).toUpperCase(),
  dataset: {},
  style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  children: [],
  childNodes: [],
  parentNode: null,
  textContent: '',
  innerHTML: '',
  className: '',
  id: '',
  setAttribute() {},
  getAttribute: () => null,
  removeAttribute() {},
  hasAttribute: () => false,
  appendChild(child) {
    domMutations += 1
    this.children.push(child)
    return child
  },
  insertBefore(child) {
    domMutations += 1
    return child
  },
  removeChild(child) {
    domMutations += 1
    return child
  },
  remove() {},
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  focus() {},
  click() {},
  cloneNode: () => makeElement(tag),
})

const reactStub = {
  createElement: (...args) => ({ __element: true, args }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  Fragment: Symbol('Fragment'),
}
const moduleTable = {
  react: reactStub,
  'react-dom': { createRoot: () => ({ render() {}, unmount() {} }) },
  'react/jsx-runtime': { jsx: (...a) => a, jsxs: (...a) => a, Fragment: reactStub.Fragment },
}

/** 未在模块表里的 specifier 用一个"万能 Proxy"应付（我们只关心请求了什么，不关心实现）。 */
const autoStub = () => new Proxy(function () {}, {
  get: (_t, property) => {
    if (property === '__esModule') return true
    if (property === 'then') return undefined
    return autoStub()
  },
  apply: () => autoStub(),
  construct: () => ({}),
})
const autoStubbed = []

const requireStub = (specifier) => {
  requireCalls.push(specifier)
  if (specifier in moduleTable) return moduleTable[specifier]
  if (!autoStubbed.includes(specifier)) autoStubbed.push(specifier)
  return autoStub()
}
requireStub.async = async (specifier) => requireStub(specifier)

const loader = {
  mode: 'queue',
  pendingQueue: registrations,
  load(registration) {
    registrations.push(registration)
  },
  create() {
    throw new Error('create() 未 stub（只有外壳 bootstrap 会用它）')
  },
}

const defineGlobal = (name, value) => {
  try {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  } catch {
    try {
      globalThis[name] = value
    } catch {
      /* 装不上就算了 */
    }
  }
}

defineGlobal('window', {
  __ModuleLoader__: loader,
  addEventListener() {},
  removeEventListener() {},
  open: () => ({}),
  location: { assign() {}, href: 'http://localhost/' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
})
defineGlobal('document', {
  head: makeElement('head'),
  body: makeElement('body'),
  documentElement: makeElement('html'),
  createElement: (tag) => makeElement(tag),
  createElementNS: (_ns, tag) => makeElement(tag),
  createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  createDocumentFragment: () => makeElement('fragment'),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener() {},
})
defineGlobal('navigator', { language: 'zh-CN', languages: ['zh-CN'], userAgent: 'node-verify' })
defineGlobal('MutationObserver', class { observe() {} disconnect() {} })
defineGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
defineGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0))
defineGlobal('cancelAnimationFrame', (id) => clearTimeout(id))

const report = []
let executed = true
let execError
try {
  new Function(source)()
} catch (error) {
  executed = false
  execError = error
}

report.push(`bundle: ${file} (${(source.length / 1024).toFixed(0)} KiB)`)
report.push(`executed: ${executed}${execError ? ` (${execError.message})` : ''}`)
report.push(`registrations: ${registrations.length}`)
report.push(`module requests during execution: ${requireCalls.length}`)
report.push(`DOM mutations during execution: ${domMutations}`)

const registration = registrations[0]
if (!registration) {
  console.log(report.join('\n'))
  console.error('\n✗ 没有观察到 __ModuleLoader__.load() 调用——这不是惰性 CJS client bundle')
  process.exit(1)
}
report.push(`registered id: ${registration.id}`)
report.push(`factory is function: ${typeof registration.factory === 'function'}`)

const lazy = executed && requireCalls.length === 0 && typeof registration.factory === 'function'
report.push(`lazy contract (materialize 前没有任何模块请求): ${lazy}`)

let exported
let materializeError
try {
  exported = registration.factory(requireStub)
} catch (error) {
  materializeError = error
}
const keys = exported && typeof exported === 'object' ? Object.keys(exported) : []
report.push(`materialized: ${exported !== undefined}${materializeError ? ` (${materializeError.message})` : ''}`)
report.push(`exports keys: ${keys.length ? keys.join(', ') : '(none)'}`)
report.push(`module requests during materialization: ${requireCalls.length} → ${[...new Set(requireCalls)].join(', ')}`)

const idOk = registration.id === expectedId
const hasApply = typeof exported?.apply === 'function'
const injectOk = Array.isArray(exported?.inject)
report.push(`id matches package name (${expectedId}): ${idOk}`)
report.push(`has apply(): ${hasApply}`)
report.push(`inject is array: ${injectOk}`)

console.log(report.join('\n'))
const ok = lazy && idOk && hasApply && injectOk
console.log(`\n${ok ? '✓' : '✗'} client bundle contract ${ok ? 'holds' : 'NOT satisfied'}`)
process.exit(ok ? 0 : 1)
