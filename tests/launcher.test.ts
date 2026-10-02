/**
 * 编排器测试：钉住「一次点击只跑一次」这条。
 *
 * 为什么必须测：用户报的现象是"点击后出现两次相同的界面"。成因是 effect 被重复执行
 * （React 严格模式 / 点击重复派发），结果是**播两遍视频 + 开两个标签页**。
 * 闸门是这次修复的核心，没有测试就等于没改。
 *
 * 写法要点：`playTransition` 的替身会在第一次调用时挂住，用来观察"进行中"；
 * 而 `launch()` 内部的 `await loadConfig()` 意味着 playTransition 不在同一微任务里被进入，
 * 所以 `release()` 必须先冲刷微任务，否则会在"还没挂上"的时候去放行（= 放行了个空，测试死等）。
 */
import { describe, expect, it, vi } from 'vitest'

import { createLauncher, DEFAULTS, LAUNCH_DEBOUNCE_MS, type ClientConfig, type LaunchRuntime } from '../src/panels.js'

/** 冲刷微任务，让 launch() 走到 playTransition 那一步。 */
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
}

/** 造一个可观察的 runtime；时钟由测试控制。 */
function makeRuntime(config: Partial<ClientConfig> = {}) {
  let clock = 0
  const calls = { loadConfig: 0, playTransition: 0, openTarget: 0 }
  let releasePlay: (() => void) | undefined
  let hangNextPlay = true

  const runtime: LaunchRuntime = {
    now: () => clock,
    loadConfig: async () => {
      calls.loadConfig += 1
      return { ...DEFAULTS, ...config }
    },
    playTransition: async () => {
      calls.playTransition += 1
      if (hangNextPlay) {
        hangNextPlay = false
        await new Promise<void>((resolve) => {
          releasePlay = resolve
        })
      }
    },
    openTarget: () => {
      calls.openTarget += 1
    },
  }

  return {
    runtime,
    calls,
    advance: (ms: number) => {
      clock += ms
    },
    /** 等 playTransition 真的被进入后再放行它。 */
    release: async () => {
      await flushMicrotasks()
      releasePlay?.()
      releasePlay = undefined
    },
  }
}

describe('createLauncher 单次触发闸门', () => {
  it('第一次跑完之后的立即重复触发被闸门拦住（这就是"出现两次界面"的修复）', async () => {
    const h = makeRuntime()
    const launcher = createLauncher(h.runtime)

    const first = launcher.launch()
    await h.release()
    await first

    await launcher.launch() // 同一时刻窗口内 → 忽略
    expect(h.calls.playTransition).toBe(1)
    expect(h.calls.openTarget).toBe(1)
  })

  it('并发触发（上一次还没结束）也只跑一次', async () => {
    const h = makeRuntime()
    const launcher = createLauncher(h.runtime)

    const first = launcher.launch()
    const second = launcher.launch() // 进行中 → 立刻返回
    await h.release()
    await Promise.all([first, second])

    expect(h.calls.loadConfig).toBe(1)
    expect(h.calls.openTarget).toBe(1)
    expect(launcher.running()).toBe(false)
  })

  it('闸门窗口过后再次触发是允许的（不是永久锁死）', async () => {
    const h = makeRuntime()
    const launcher = createLauncher(h.runtime)

    const first = launcher.launch()
    await h.release()
    await first

    h.advance(LAUNCH_DEBOUNCE_MS + 1)
    await launcher.launch()
    expect(h.calls.openTarget).toBe(2)
  })

  it('闸门窗口的边界：窗口内忽略、越过窗口才放行', async () => {
    const h = makeRuntime()
    const launcher = createLauncher(h.runtime)

    const first = launcher.launch()
    await h.release()
    await first

    h.advance(LAUNCH_DEBOUNCE_MS - 1)
    await launcher.launch()
    expect(h.calls.openTarget).toBe(1)

    h.advance(2)
    await launcher.launch()
    expect(h.calls.openTarget).toBe(2)
  })

  it('transition: none 时跳过过场但仍然跳转', async () => {
    const h = makeRuntime({ transition: 'none' })
    const launcher = createLauncher(h.runtime)

    await launcher.launch()

    expect(h.calls.playTransition).toBe(0)
    expect(h.calls.openTarget).toBe(1)
  })

  it('loadConfig 抛错时不会把 running 卡住（后续仍可触发）', async () => {
    let clock = 0
    const openTarget = vi.fn()
    const launcher = createLauncher({
      now: () => clock,
      loadConfig: async () => {
        throw new Error('boom')
      },
      playTransition: async () => {},
      openTarget,
    })

    await expect(launcher.launch()).rejects.toThrow('boom')
    expect(launcher.running()).toBe(false)

    clock += LAUNCH_DEBOUNCE_MS + 1
    await launcher.launch().catch(() => undefined)
    expect(launcher.running()).toBe(false)
    expect(openTarget).not.toHaveBeenCalled()
  })
})
