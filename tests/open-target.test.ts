/**
 * 开窗逻辑测试：钉住「只开一个」这条。
 *
 * 背景（本机实测的根因）：DSH 桌面版的 Electron 主进程里，
 * `view.webContents.setWindowOpenHandler` **永远返回 `{action:'deny'}`**，并且顺手
 * `shell.openExternal(url)`。于是：
 *   - 任何 `window.open` 在桌面版都返回 `null`；
 *   - 但网站**已经被宿主用系统浏览器打开了一次**；
 *   - 若此时再"因为返回 null 所以降级 `location.assign`"，就会打开第二次。
 *
 * 所以这里固定三条：**只调用一次 `window.open`**、**返回 null 时不导航**、具名窗口 + 手动清 opener。
 */
import { describe, expect, it, vi } from 'vitest'

import { createOpenTarget, DEFAULTS, WINDOW_NAME, type ClientConfig, type WindowLike } from '../src/panels.js'

function makeWindow(openResult: unknown) {
  const assign = vi.fn()
  const open = vi.fn(() => openResult)
  const win: WindowLike = { open, location: { assign } }
  return { win, assign, open }
}

const config: ClientConfig = { ...DEFAULTS }

describe('createOpenTarget', () => {
  it('new-tab：只用具名窗口调用一次 window.open，且不写 noopener features', () => {
    const opened = { opener: {}, focus: vi.fn() }
    const { win, open, assign } = makeWindow(opened)

    const outcome = createOpenTarget(win)(config)

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(config.targetUrl, WINDOW_NAME)
    // 只传两个参数：把 noopener 写进 features 会让 window.open 必返回 null
    expect((open.mock.calls[0] as unknown[]).length).toBe(2)
    expect(assign).not.toHaveBeenCalled()
    expect(outcome).toEqual({ kind: 'opened', handleReturned: true })
  })

  it('拿到句柄后手动清 opener（等价 noopener 的安全性）', () => {
    const opened: { opener: unknown; focus: () => void } = { opener: {}, focus: vi.fn() }
    const { win } = makeWindow(opened)

    createOpenTarget(win)(config)

    expect(opened.opener).toBeNull()
  })

  it('★ 返回 null 时**不导航**（桌面版必然为 null，导航会导致打开两次）', () => {
    const { win, assign, open } = makeWindow(null)

    const outcome = createOpenTarget(win)(config)

    expect(open).toHaveBeenCalledTimes(1)
    expect(assign).not.toHaveBeenCalled() // ← 这条就是"打开两次"的修复
    expect(outcome).toEqual({ kind: 'blocked', handleReturned: false })
  })

  it('undefined 同样按 blocked 处理，不导航', () => {
    const { win, assign } = makeWindow(undefined)

    const outcome = createOpenTarget(win)(config)

    expect(assign).not.toHaveBeenCalled()
    expect(outcome.kind).toBe('blocked')
  })

  it('openIn: same-tab 时不调用 window.open，直接当前页跳转', () => {
    const { win, assign, open } = makeWindow({ focus: vi.fn() })

    const outcome = createOpenTarget(win)({ ...config, openIn: 'same-tab' })

    expect(open).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith(config.targetUrl)
    expect(outcome).toEqual({ kind: 'same-tab', handleReturned: false })
  })

  it('opener 不可写（冻结/跨源）时不影响流程', () => {
    const opened = Object.freeze({ focus: vi.fn() }) as { focus: () => void }
    const { win, assign } = makeWindow(opened)

    expect(() => createOpenTarget(win)(config)).not.toThrow()
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('默认配置', () => {
  it('默认带声音', () => {
    expect(DEFAULTS.muted).toBe(false)
  })
})
