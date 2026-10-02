/**
 * 开窗逻辑测试：钉住「只开一个」这条。
 *
 * 用户报过"网站还是打开了两个"。成因是一个规范细节：
 * **`window.open(url, '_blank', 'noopener,...')` 一定返回 `null`**，
 * 于是"返回 null 就降级到当前页跳转"的逻辑被误触发——新标签页开了，当前页也跳了。
 *
 * 所以这里把三条都固定下来：具名窗口、返回 null 才降级、same-tab 直接跳。
 */
import { describe, expect, it, vi } from 'vitest'

import { createOpenTarget, DEFAULTS, WINDOW_NAME, type ClientConfig, type WindowLike } from '../src/panels.js'

function makeWindow(openResult: unknown) {
  const assign = vi.fn()
  const open = vi.fn(() => openResult)
  const win: WindowLike = { open, location: { assign } }
  return { win, assign, open }
}

describe('createOpenTarget', () => {
  it('用具名窗口打开（同名会被浏览器复用，从根上避免开两个）', () => {
    const opened = { opener: {}, focus: vi.fn() }
    const { win, open, assign } = makeWindow(opened)

    createOpenTarget(win)({ ...DEFAULTS })

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(DEFAULTS.targetUrl, WINDOW_NAME)
    // 关键：不把 noopener 写进 features（那会让 window.open 必返回 null）
    expect((open.mock.calls[0] as unknown[]).length).toBe(2)
    expect(assign).not.toHaveBeenCalled()
  })

  it('打开成功后手动把 opener 置空（等价于 noopener 的安全性）', () => {
    const opened: { opener: unknown; focus: () => void } = { opener: {}, focus: vi.fn() }
    const { win } = makeWindow(opened)

    createOpenTarget(win)({ ...DEFAULTS })

    expect(opened.opener).toBeNull()
  })

  it('只有真的被拦下（返回 null）才降级到当前页跳转', () => {
    const { win, assign, open } = makeWindow(null)

    createOpenTarget(win)({ ...DEFAULTS })

    expect(open).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith(DEFAULTS.targetUrl)
  })

  it('openIn: same-tab 时不调用 window.open，直接当前页跳转', () => {
    const { win, assign, open } = makeWindow({ focus: vi.fn() })

    createOpenTarget(win)({ ...DEFAULTS, openIn: 'same-tab' })

    expect(open).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith(DEFAULTS.targetUrl)
  })

  it('opener 不可写（跨源）时不影响流程', () => {
    const opened = Object.freeze({ focus: vi.fn() }) as { focus: () => void }
    const { win, assign } = makeWindow(opened)

    expect(() => createOpenTarget(win)({ ...DEFAULTS })).not.toThrow()
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('默认配置', () => {
  it('默认带声音（用户报过"没有声音"，那是 muted 默认 true 导致的）', () => {
    expect(DEFAULTS.muted).toBe(false)
  })
})
