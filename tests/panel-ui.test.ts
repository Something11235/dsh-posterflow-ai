/**
 * 面板 UI 契约测试。
 *
 * 需求原话：「这里只保留 🖼 已开启 和 手动打开 PosterFlow 的文字，其他两行不用显示」。
 * 所以面板**只能有两个子节点**：标题 + 手动链接。诊断计数改为只写 console，不再出现在界面上。
 * 把它钉成断言，免得以后又"顺手加一行"。
 */
import { describe, expect, it } from 'vitest'

import {
  createPanelPlugin,
  DEFAULTS,
  SLOT_MAIN,
  type ClientConfig,
  type OpenOutcome,
  type ReactLike,
} from '../src/panels.js'

interface Element {
  type: unknown
  props: Record<string, unknown> | null
  children: unknown[]
}

/** 把 createElement 变成可检查的普通对象树；useEffect 不执行（不触发跳转）。 */
const fakeReact: ReactLike = {
  createElement: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): Element => ({
    type,
    props: props ?? null,
    children,
  }),
  useState: <T,>(initial: T) => [initial, () => {}] as [T, (next: T) => void],
  useEffect: () => {},
  useRef: <T,>(initial: T) => ({ current: initial }),
}

const stubRuntime = {
  loadConfig: async (): Promise<ClientConfig> => DEFAULTS,
  playTransition: async (): Promise<void> => {},
  openTarget: (): OpenOutcome => ({ kind: 'opened', handleReturned: true }),
}

/** 抓到各 slot 注册的组件。 */
function mountPanel() {
  const components = new Map<string, unknown>()
  const ctx = {
    slots: {
      inject(_key: string, callback: () => unknown): () => void {
        const inner = callback()
        return () => {
          if (typeof inner === 'function') (inner as () => void)()
        }
      },
      register(options: { name: string }, component: unknown): () => void {
        components.set(String(options.name), component)
        return () => {}
      },
    },
  }
  createPanelPlugin(fakeReact, stubRuntime).apply(ctx as never)
  const Panel = components.get(SLOT_MAIN) as () => Element
  return Panel()
}

describe('主面板 UI', () => {
  it('只有两行：标题 + 手动链接（诊断行与提示行都不显示）', () => {
    const tree = mountPanel()

    expect(tree.children).toHaveLength(2)
    expect(tree.children.map((child) => (child as Element).props?.key)).toEqual(['title', 'manual'])
  })

  it('第一行文案是「🖼 已开启」', () => {
    const title = mountPanel().children[0] as Element

    expect(title.children).toEqual(['🖼 已开启'])
  })

  it('第二行是打开 PosterFlow 的手动链接', () => {
    const link = mountPanel().children[1] as Element

    expect(link.type).toBe('a')
    expect(link.children).toEqual(['手动打开 PosterFlow'])
    expect(link.props?.href).toBe(DEFAULTS.targetUrl)
    expect(link.props?.target).toBe('_blank')
    expect(link.props?.rel).toBe('noopener noreferrer')
  })

  it('界面上不再出现诊断计数文本', () => {
    const flat = JSON.stringify(mountPanel())

    for (const marker of ['触发', 'apply', 'effect', '渲染', '被拦', '正在播放过场']) {
      expect(flat).not.toContain(marker)
    }
  })
})
