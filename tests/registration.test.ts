/**
 * 注册契约测试：钉住「侧栏主列表最后一行 + 同 id 主面板」这个摆放位置。
 *
 * 为什么值得专门测：位置本身就是需求（「放最后一排」）。而 Slot 注册失败的典型表现是
 * **静默不渲染**——写错 key、漏了 inject 包裹、order 不够大，都只会让按钮不出现，
 * 不会有任何报错。把它固定成断言，以后改动时能被立刻发现。
 */
import { describe, expect, it } from 'vitest'

import { apply as hostApply, Config, inject as hostInject, name as hostName, PANEL_ID, PANEL_ORDER, SLOT_MAIN, SLOT_PANEL_LIST, type Config as PluginConfig } from '../src/index.js'
import { createPanelPlugin, DEFAULTS, INLINED_VIDEO_BYTES, PANEL_ID as CLIENT_PANEL_ID, type ClientConfig, type OpenOutcome, type ReactLike } from '../src/panels.js'
import { TRANSITION_VIDEO_DATA_URI } from '../src/generated/transition-video.js'

/** 记录注册行为的最小假 ctx（只实现 client 侧真正用到的面）。 */
function createFakeContext() {
  const registrations: Array<{ slot: string; options: Record<string, unknown> }> = []
  const injected: string[] = []
  const disposed: string[] = []
  const disposers: Array<() => void> = []

  const ctx = {
    slots: {
      // 真实契约：inject(key, cb) 返回的 disposer 负责拆掉 cb 建立的那条注册
      inject(key: string, callback: () => unknown) {
        injected.push(key)
        const inner = callback()
        const disposer = (): void => {
          if (typeof inner === 'function') (inner as () => void)()
          disposed.push(`inject:${key}`)
        }
        disposers.push(disposer)
        return disposer
      },
      register(options: Record<string, unknown>) {
        const slot = String(options.name)
        registrations.push({ slot, options })
        return () => void disposed.push(`register:${slot}`)
      },
    },
  }

  return { ctx: ctx as never, registrations, injected, disposed, disposers }
}

/** 单测用：不碰 DOM 的副作用替身。 */
const stubRuntime = {
  loadConfig: async (): Promise<ClientConfig> => DEFAULTS,
  playTransition: async (): Promise<void> => {},
  openTarget: (): OpenOutcome => ({ kind: 'opened', handleReturned: true }),
}

/** 只提供 createElement/useState/useEffect/useRef 的最小 React 替身。 */
const fakeReact: ReactLike = {
  createElement: () => null,
  useState: <T,>(initial: T) => [initial, () => {}] as [T, (next: T) => void],
  useEffect: () => {},
  useRef: <T,>(initial: T) => ({ current: initial }),
}

describe('client 半边的注册契约', () => {
  it('侧栏主列表：id 固定、order 排在「插件(0) / 自动化任务(10)」之后', () => {
    const fake = createFakeContext()
    createPanelPlugin(fakeReact, stubRuntime).apply(fake.ctx)

    const row = fake.registrations.find((r) => r.slot === SLOT_PANEL_LIST)
    expect(row).toBeDefined()
    if (row === undefined) return // 上面的断言已经失败，这里只是收窄类型

    expect(row.options.id).toBe(PANEL_ID)
    expect(row.options.order).toBe(PANEL_ORDER)
    expect(PANEL_ORDER).toBeGreaterThan(10) // 大于 schedules 的 10，才是"最后一排"
    expect(typeof row.options.label).toBe('function') // label 用函数形式，投影时求值
    expect((row.options.label as () => string)()).toBe('开启生图模式')
  })

  it('主面板：用同一个 id 作为 keyed key，点击那一行才有内容可渲染', () => {
    const fake = createFakeContext()
    createPanelPlugin(fakeReact, stubRuntime).apply(fake.ctx)

    const panel = fake.registrations.find((r) => r.slot === SLOT_MAIN)
    expect(panel).toBeDefined()
    if (panel === undefined) return

    expect(panel.options.key).toBe(PANEL_ID)
    // list 槽用 id、keyed 槽用 key，不要互相串用
    expect(panel.options.id).toBeUndefined()
  })

  it('两处注册都走 slots.inject 包裹（等声明就绪，避免静默丢失）', () => {
    const fake = createFakeContext()
    createPanelPlugin(fakeReact, stubRuntime).apply(fake.ctx)

    expect(fake.injected).toEqual([SLOT_PANEL_LIST, SLOT_MAIN])
    expect(fake.registrations).toHaveLength(2)
  })

  it('两处注册都随 inject 的 disposer 一起回滚（卸载时不残留）', () => {
    const fake = createFakeContext()
    createPanelPlugin(fakeReact, stubRuntime).apply(fake.ctx)

    // inject 返回的 each disposer 必须把内部那条注册也拆掉
    for (const disposer of fake.disposers) disposer()
    expect(fake.disposed).toContain(`register:${SLOT_PANEL_LIST}`)
    expect(fake.disposed).toContain(`register:${SLOT_MAIN}`)
    expect(fake.disposed).toContain(`inject:${SLOT_PANEL_LIST}`)
    expect(fake.disposed).toContain(`inject:${SLOT_MAIN}`)
  })

  it('客户端常量与宿主半边导出的常量一致（防止两处漂移）', () => {
    expect(CLIENT_PANEL_ID).toBe(PANEL_ID)
  })
})

describe('插件元数据', () => {
  it('宿主半边：名字与注入项符合 DSH 约定', () => {
    expect(hostName).toBe('posterflow-ai')
    expect(hostInject).toEqual([]) // webServer 是可选能力，用 ctx.get 读取
    expect(typeof Config).toBe('function')
    expect(typeof hostApply).toBe('function')
  })

  it('宿主 Config 默认值就是需求里的那套', () => {
    const validated = (Config as unknown as (value: unknown) => PluginConfig)({})
    expect(validated.targetUrl).toBe('https://www.posterflow-ai.xyz/')
    expect(validated.buttonLabel).toBe('开启生图模式')
    expect(validated.openIn).toBe('new-tab')
    expect(validated.transition).toBe('video')
    expect(validated.videoSource).toBe('inline') // 默认内联：不依赖端口/路由，一定能播
    expect(validated.videoFile).toBe('assets/transition.webm')
    expect(validated.muted).toBe(false) // 默认带声音
    expect(validated.maxWaitMs).toBe(8000)
  })

  it('client 半边默认值与宿主默认值一致（兜底时行为不漂移）', () => {
    expect(DEFAULTS.targetUrl).toBe('https://www.posterflow-ai.xyz/')
    expect(DEFAULTS.buttonLabel).toBe('开启生图模式')
    expect(DEFAULTS.openIn).toBe('new-tab')
    expect(DEFAULTS.transition).toBe('video')
    expect(DEFAULTS.videoSource).toBe('inline')
    expect(DEFAULTS.videoUrl).toBe('') // inline 模式下不使用路由地址
    expect(DEFAULTS.muted).toBe(false) // 默认带声音
    expect(DEFAULTS.maxWaitMs).toBe(8000)
  })

  it('内联视频确实随产物带上了（不是空串）', () => {
    expect(INLINED_VIDEO_BYTES).toBeGreaterThan(100_000)
    expect(TRANSITION_VIDEO_DATA_URI.startsWith('data:video/webm;base64,')).toBe(true)
  })

  it('client 半边音 / inject 契约', () => {
    const plugin = createPanelPlugin(fakeReact, stubRuntime)
    expect(plugin.name).toBe('posterflow-ai')
    expect(plugin.inject).toEqual(['slots'])
  })
})
