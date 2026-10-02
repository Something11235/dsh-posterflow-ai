/**
 * 编排器测试：钉住「一次点击只跑一次」这条。
 *
 * 为什么必须测：用户报的现象是"点击后站点被打开两次"。成因是 effect 被重复执行
 * （React 严格模式 / slot 重注册导致面板重新挂载 / 点击重复派发），结果是**跳转跑了两遍**。
 * 现在去重窗口是 `LAUNCH_DEDUPE_MS`（20 秒），必须显著大于过场视频时长，
 * 否则"视频播完后面板重新挂载"会再触发一次跳转。
 *
 * 写法要点：`playTransition` 的替身会在第一次调用时挂住，用来观察"进行中"；
 * 而 `launch()` 内部的 `await loadConfig()` 意味着 playTransition 不在同一微任务里被进入，
 * 所以 `release()` 必须先冲刷微任务。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createLauncher,
  DEFAULTS,
  diagnostics,
  LAUNCH_DEDUPE_MS,
  resetDiagnostics,
  type ClientConfig,
  type LaunchRuntime,
  type OpenOutcome,
} from '../src/panels.js'

/** 冲刷微任务，让 launch() 走到 playTransition 那一步。 */
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
}

const OPENED: OpenOutcome = { kind: 'opened', handleReturned: true }

/** 造一个可观察的 runtime；时钟由测试控制。 */
function makeRuntime(config: Partial<ClientConfig> = {}, openOutcome: OpenOutcome = OPENED) {
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
      return openOutcome
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

beforeEach(() => {
  resetDiagnostics()
})

describe('createLauncher 去重闸门', () => {
  it('第一次跑完之后的重复触发被去重窗口拦住', async () => {
    const h = makeRuntime()
    const launcher = createLauncher(h.runtime)

    const first = launcher.launch()
    await h.release()
    const firstOutcome = await first
    expect(firstOutcome).toEqual({ ran: true, open: OPENED })

    const second = await launcher.launch()
    expect(second).toEqual({ ran: false, reason: 'deduped' })
    expect(h.calls.playTransition).toBe(1)
    expect(h.calls.openTarget).toBe(1)
  })

  it('并发触发（上一次还没结束）返回 in-flight，且不重复开窗', async () => {
    const h = makeRuntime()
    const launcher = createLauncher(h.runtime)

    const first = launcher.launch()
    const second = await launcher.launch() // 进行中 → 立刻返回
    await h.release()
    await first

    expect(second).toEqual({ ran: false, reason: 'in-flight' })
    expect(h.calls.loadConfig).toBe(1)
    expect(h.calls.openTarget).toBe(1)
    expect(launcher.running()).toBe(false)
  })

  it('★ 模拟"视频播完后面板重新挂载"：间隔 6.5 秒的重挂载也不会再开一次', async () => {
    const h = makeRuntime()
    const launcher = createLauncher(h.runtime)

    const first = launcher.launch()
    await h.release()
    await first
    expect(h.calls.openTarget).toBe(1)

    // 过场视频约 6.5 秒；老的 1.5 秒窗口正是挡不住这种情况
    h.advance(6500)
    const remount = await launcher.launch()
    expect(remount).toEqual({ ran: false, reason: 'deduped' })
    expect(h.calls.openTarget).toBe(1)
  })

  it('去重窗口过后可以再次触发（不是永久锁死）', async () => {
    const h = makeRuntime()
    const launcher = createLauncher(h.runtime)

    const first = launcher.launch()
    await h.release()
    await first

    h.advance(LAUNCH_DEDUPE_MS + 1)
    const again = await launcher.launch()
    expect(again.ran).toBe(true)
    expect(h.calls.openTarget).toBe(2)
  })

  it('去重窗口的边界：窗口内忽略、越过窗口才放行', async () => {
    const h = makeRuntime()
    const launcher = createLauncher(h.runtime)

    const first = launcher.launch()
    await h.release()
    await first

    h.advance(LAUNCH_DEDUPE_MS - 1)
    expect((await launcher.launch()).ran).toBe(false)

    h.advance(2)
    expect((await launcher.launch()).ran).toBe(true)
    expect(h.calls.openTarget).toBe(2)
  })

  it('transition: none 时跳过过场但仍然跳转', async () => {
    const h = makeRuntime({ transition: 'none' })
    const launcher = createLauncher(h.runtime)

    const outcome = await launcher.launch()

    expect(h.calls.playTransition).toBe(0)
    expect(h.calls.openTarget).toBe(1)
    expect(outcome.ran).toBe(true)
  })

  it('loadConfig 抛错时不会把 running 卡住（窗口过后仍可触发）', async () => {
    let clock = 0
    const openTarget = vi.fn(() => OPENED)
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

    clock += LAUNCH_DEDUPE_MS + 1
    await launcher.launch().catch(() => undefined)
    expect(launcher.running()).toBe(false)
  })

  it('跳转被拦（blocked）时把结果与诊断计数带出来', async () => {
    const h = makeRuntime({ transition: 'none' }, { kind: 'blocked', handleReturned: false })
    const launcher = createLauncher(h.runtime)

    const outcome = await launcher.launch()

    expect(outcome.open).toEqual({ kind: 'blocked', handleReturned: false })
    expect(diagnostics.blocked).toBe(1)
  })

  it('诊断计数能反映真实执行次数（面板就是靠它显示"触发 N 次"）', async () => {
    const h = makeRuntime()
    const launcher = createLauncher(h.runtime)

    const first = launcher.launch()
    await h.release()
    await first
    await launcher.launch() // 被去重

    expect(diagnostics.launches).toBe(1)
    expect(diagnostics.opens).toBe(1)
  })
})
