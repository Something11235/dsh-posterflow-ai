/**
 * client 半边的实现（可测试的模块层）。
 *
 * 为什么把逻辑放在这里而不是直接写在 `client.ts` 里：
 * `client.ts` 必须是"执行即注册工厂"的脚本形态，没法被测试导入。
 * 抽成模块后：① 注册契约可单测；② 构建时会被 inline 进 `lib/client.js`，
 * 产物依然是零 npm 依赖的普通脚本。
 *
 * 唯一的运行时依赖是注入的 React（模块表里的基线库 `react`）。
 */

/** 注入的 React。只声明用到的成员。 */
export interface ReactLike {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  useState<T>(initial: T): [T, (next: T) => void]
  useEffect(effect: () => void | (() => unknown), deps?: readonly unknown[]): void
  useRef<T>(initial: T): { current: T }
}

/** 宿主通过 JSON 路由递过来的运行时配置。 */
export interface ClientConfig {
  targetUrl: string
  buttonLabel: string
  openIn: 'new-tab' | 'same-tab'
  transition: 'video' | 'none'
  videoUrl: string
  muted: boolean
  maxWaitMs: number
}

/** 与宿主 Config 默认值保持一致：路由读不到时用它们兜底。 */
export const DEFAULTS: ClientConfig = {
  targetUrl: 'https://www.posterflow-ai.xyz/',
  buttonLabel: '开启生图模式',
  openIn: 'new-tab',
  transition: 'video',
  videoUrl: '/posterflow-ai/transition.webm',
  muted: true,
  maxWaitMs: 8000,
}

/** 侧栏主列表那一行的 id，同时也是 `main` 面板的 key。 */
export const PANEL_ID = 'posterflow-ai'
/** 侧栏主列表（「插件」「自动化任务」所在的那一列）。 */
export const SLOT_PANEL_LIST = 'sidebar.panellist'
/** 主面板 keyed 槽，承载过场与跳转。 */
export const SLOT_MAIN = 'main'
/** 排在最后一行：既有的 plugins = 0、schedules = 10。 */
export const PANEL_ORDER = 100

export interface SlotRegisterOptions {
  name: string
  /** list / single 槽用它。 */
  id?: string
  /** keyed 槽用它。 */
  key?: string
  order?: number
  label?: string | (() => string)
}

/** client 端 ctx 里本插件用到的部分。 */
export interface ClientContext {
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(options: SlotRegisterOptions, component: unknown): () => void
  }
}

/** client 插件契约（与宿主半边同形：name / inject / apply）。 */
export interface PanelPlugin {
  name: string
  inject: string[]
  apply(ctx: ClientContext): void
}

/** 可替换的副作用实现，便于在 Node 里单测注册契约而不碰 DOM。 */
export interface PanelRuntime {
  loadConfig?: () => Promise<ClientConfig>
  playTransition?: (config: ClientConfig) => Promise<void>
  openTarget?: (config: ClientConfig) => void
}

interface DomNode {
  style: Record<string, string>
  setAttribute(name: string, value: string): void
  appendChild(child: unknown): void
  addEventListener(type: string, listener: () => void): void
  remove(): void
}

interface VideoNode extends DomNode {
  src: string
  autoplay: boolean
  muted: boolean
  playsInline: boolean
  play(): Promise<void> | undefined
}

// 只声明用到的那部分浏览器全局（本包的 tsconfig 不含 DOM lib）
declare const fetch: (input: string, init?: { cache?: string }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>
declare const window: {
  open(url: string, target?: string, features?: string): unknown
  location: { assign(url: string): void }
}
declare const document: {
  createElement(tag: string): DomNode
  body: DomNode
}

/**
 * 组装 client 插件。
 * @param React - 注入的 React。
 * @param runtime - 可选：覆盖副作用实现（单测用）。
 * @returns client 插件对象。
 */
export function createPanelPlugin(React: ReactLike, runtime: PanelRuntime = {}): PanelPlugin {
  let cached: ClientConfig | undefined

  /** 读宿主配置；任何失败都用默认值兜底，绝不因此让入口失灵。 */
  const loadConfig =
    runtime.loadConfig ??
    (async (): Promise<ClientConfig> => {
      if (cached !== undefined) return cached
      try {
        const response = await fetch('/posterflow-ai/config.json', { cache: 'no-store' })
        if (!response.ok) throw new Error(`config route returned ${response.status}`)
        const payload = (await response.json()) as Partial<ClientConfig>
        cached = { ...DEFAULTS, ...payload }
      } catch {
        cached = DEFAULTS
      }
      return cached
    })

  /** 跳转；`new-tab` 被浏览器拦下时降级为当前页跳转。 */
  const openTarget =
    runtime.openTarget ??
    ((config: ClientConfig): void => {
      if (config.openIn === 'same-tab') {
        window.location.assign(config.targetUrl)
        return
      }
      const opened = window.open(config.targetUrl, '_blank', 'noopener,noreferrer')
      if (opened === null || opened === undefined) window.location.assign(config.targetUrl)
    })

  /** 播放过场视频；结束、出错、超时、或用户点击画面都会立刻放行。 */
  const playTransition =
    runtime.playTransition ??
    ((config: ClientConfig): Promise<void> =>
      new Promise((resolve) => {
        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const overlay = document.createElement('div')
        const video = document.createElement('video') as unknown as VideoNode

        const finish = (): void => {
          if (settled) return
          settled = true
          if (timer !== undefined) clearTimeout(timer)
          try {
            video.remove()
          } catch {
            /* 已经脱离文档 */
          }
          try {
            overlay.remove()
          } catch {
            /* 已经脱离文档 */
          }
          resolve()
        }

        // muted 必须在 play() 之前设置，否则浏览器会拦下自动播放
        video.muted = config.muted
        video.autoplay = true
        video.playsInline = true
        video.src = config.videoUrl
        Object.assign(video.style, { maxWidth: '100%', maxHeight: '100%' })
        video.addEventListener('ended', finish)
        video.addEventListener('error', finish)

        overlay.setAttribute('role', 'presentation')
        overlay.setAttribute('aria-hidden', 'true')
        Object.assign(overlay.style, {
          position: 'fixed',
          inset: '0',
          zIndex: '2147483000',
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        })
        // 点一下就能跳过，不让用户被过场卡住
        overlay.addEventListener('click', finish)
        overlay.appendChild(video)
        document.body.appendChild(overlay)

        timer = setTimeout(finish, config.maxWaitMs)
        const played = video.play()
        if (played !== undefined && typeof played.catch === 'function') played.catch(finish)
      }))

  /**
   * 侧栏那一行只接收**图标**的 owner props（`size` 与 `active`）：
   * 按钮与文案由侧栏自己渲染，文案取自注册时的 `label` 元数据。
   */
  const Icon = (props: { size?: number; active?: boolean }): unknown => {
    const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16
    return React.createElement(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        style: {
          display: 'block',
          color: props.active === true ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        },
      },
      React.createElement('rect', { key: 'frame', x: 3, y: 4.5, width: 18, height: 15, rx: 3 }),
      React.createElement('circle', { key: 'sun', cx: 8.5, cy: 9.5, r: 1.4 }),
      React.createElement('path', { key: 'hill', d: 'M4.5 17.5l4.5-4.5 3.5 3.5 2.5-2.5 4 4' }),
    )
  }

  /**
   * 主面板：挂载即跑「过场 → 跳转」。
   * 必须去重——React 严格模式下 effect 会跑两次，不去重会播两遍视频、开两个标签页。
   */
  const Panel = (): unknown => {
    const [phase, setPhase] = React.useState<'running' | 'done'>('running')
    const [message, setMessage] = React.useState('正在开启生图模式…')
    const [targetUrl, setTargetUrl] = React.useState(DEFAULTS.targetUrl)
    const started = React.useRef(false)

    React.useEffect(() => {
      if (started.current) return
      started.current = true
      void (async () => {
        const config = await loadConfig()
        setTargetUrl(config.targetUrl)
        if (config.transition === 'video') {
          setMessage('过场播放中…（点击画面可跳过）')
          await playTransition(config)
        }
        openTarget(config)
        setPhase('done')
        setMessage(`已打开 ${config.targetUrl}`)
      })()
    }, [])

    const link = React.createElement(
      'a',
      {
        key: 'manual',
        href: targetUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        style: { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'underline' },
      },
      '手动打开 PosterFlow',
    )

    return React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          height: '100%',
          minHeight: '240px',
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: '13px',
        },
      },
      React.createElement(
        'div',
        { key: 'title', style: { fontSize: '15px', color: 'var(--dsw-alias-label-primary)' } },
        phase === 'running' ? '🖼 开启生图模式' : '🖼 已开启',
      ),
      React.createElement('div', { key: 'message' }, message),
      link,
    )
  }

  const apply = (ctx: ClientContext): void => {
    // ① 侧栏主列表最后一行（label 用函数形式，投影时求值）
    ctx.slots.inject(SLOT_PANEL_LIST, () =>
      ctx.slots.register(
        {
          name: SLOT_PANEL_LIST,
          id: PANEL_ID,
          order: PANEL_ORDER,
          label: () => DEFAULTS.buttonLabel,
        },
        Icon,
      ),
    )

    // ② 同 id 的主面板：点击侧栏那一行会切到这里，由它完成过场与跳转
    ctx.slots.inject(SLOT_MAIN, () => ctx.slots.register({ name: SLOT_MAIN, key: PANEL_ID }, Panel))
  }

  return { name: 'posterflow-ai', inject: ['slots'], apply }
}
