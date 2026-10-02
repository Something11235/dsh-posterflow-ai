/**
 * client 半边的实现（可测试的模块层）。
 *
 * 为什么把逻辑放在这里而不是直接写在 `client.ts` 里：
 * `client.ts` 必须是"执行即注册工厂"的脚本形态，没法被测试导入。
 * 抽成模块后：① 注册契约与单次触发闸门可单测；② 构建时会被 inline 进 `lib/client.js`，
 * 产物依然是零 npm 依赖的普通脚本。
 *
 * 视频交付方式（本机实测后的最终选择）：
 * 桌面版 GUI（127.0.0.1:19387）**不是** `ctx.webServer` 的路由面——连内核自己的 `/plugins/...`
 * 都 404，所以"宿主注册 HTTP 路由、页面去取"这条路在桌面版走不通，表现就是"完全没播"。
 * 现在默认把视频以 data URI 内联在产物里（由 scripts/embed-video.mjs 生成），
 * 不依赖端口、协议或路由，**一定能播**；`videoSource: 'route'` 仍保留给能走通路由的部署。
 */
import { TRANSITION_VIDEO_BYTES, TRANSITION_VIDEO_DATA_URI } from './generated/transition-video.js'

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
  /** `inline` = 用产物里内联的视频（默认，必成功）；`route` = 用宿主 HTTP 路由。 */
  videoSource: 'inline' | 'route'
  /** `route` 模式下的视频地址；`inline` 模式忽略。 */
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
  videoSource: 'inline',
  videoUrl: '',
  muted: true,
  maxWaitMs: 8000,
}

/** 单次触发闸门的时间窗：这段时间内的重复触发一律忽略。 */
export const LAUNCH_DEBOUNCE_MS = 1500

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

/** 副作用实现，可在 Node 里替换以便单测。 */
export interface LaunchRuntime {
  loadConfig: () => Promise<ClientConfig>
  playTransition: (config: ClientConfig) => Promise<void>
  openTarget: (config: ClientConfig) => void
  /** 可注入的时钟，便于测闸门。 */
  now?: () => number
}

/** 一次「过场 → 跳转」的编排，带单次触发闸门。 */
export interface Launcher {
  launch(): Promise<void>
  running(): boolean
}

/**
 * 创建编排器。
 *
 * 为什么要闸门：React 严格模式下 effect 会跑两次，侧栏那一行的点击也可能被重复派发；
 * 没有闸门就会**播两遍视频、开两个标签页**（用户报的"出现两次相同的界面"）。
 * 闸门放在闭包里，组件重新挂载也拦得住。
 *
 * @param runtime - 副作用实现（可注入替身）。
 * @returns 编排器。
 */
export function createLauncher(runtime: LaunchRuntime): Launcher {
  const now = runtime.now ?? ((): number => Date.now())
  let lastLaunchAt = Number.NEGATIVE_INFINITY
  let inFlight = false

  return {
    running: () => inFlight,
    async launch(): Promise<void> {
      const at = now()
      if (inFlight || at - lastLaunchAt < LAUNCH_DEBOUNCE_MS) return
      inFlight = true
      lastLaunchAt = at
      try {
        const config = await runtime.loadConfig()
        if (config.transition === 'video') await runtime.playTransition(config)
        runtime.openTarget(config)
      } finally {
        inFlight = false
      }
    },
  }
}

/** 可覆盖的副作用实现。 */
export type PanelRuntime = Partial<LaunchRuntime>

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

  /** 读宿主配置；任何失败都用默认值兜底（默认可内联视频，所以仍然能播）。 */
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

  /** 视频地址：默认用内联的 data URI，部署方显式要求 route 时才走宿主路由。 */
  const videoSourceFor = (config: ClientConfig): string =>
    config.videoSource === 'route' && config.videoUrl !== '' ? config.videoUrl : TRANSITION_VIDEO_DATA_URI

  /**
   * 播放过场视频，**铺满整个窗口**。
   * 结束 / 出错 / 超时 / 点击画面都会立刻放行；绝不把用户卡在过场里。
   */
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

        // 先静音：这是自动播放不被浏览器拦下的唯一可靠保证。
        // 若配置要求有声，等 'playing' 之后再取消静音——改属性不会触发 play() 拒绝。
        video.muted = true
        video.autoplay = true
        video.playsInline = true
        video.src = videoSourceFor(config)
        Object.assign(video.style, {
          width: '100%',
          height: '100%',
          objectFit: 'cover', // 铺满窗口，保持比例裁切
          display: 'block',
        })
        video.addEventListener('ended', finish)
        video.addEventListener('error', finish)
        video.addEventListener('playing', () => {
          if (!config.muted) video.muted = false
        })

        overlay.setAttribute('role', 'presentation')
        overlay.setAttribute('aria-hidden', 'true')
        Object.assign(overlay.style, {
          position: 'fixed',
          inset: '0',
          width: '100%',
          height: '100%',
          zIndex: '2147483000',
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: 'pointer',
        })
        // 点一下就能跳过
        overlay.addEventListener('click', finish)
        overlay.appendChild(video)
        document.body.appendChild(overlay)

        timer = setTimeout(finish, config.maxWaitMs)
        const played = video.play()
        if (played !== undefined && typeof played.catch === 'function') played.catch(finish)
      }))

  const launcher = createLauncher({
    loadConfig,
    playTransition,
    openTarget,
    ...(runtime.now === undefined ? {} : { now: runtime.now }),
  })

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

  /** 主面板：挂载即启动编排（闸门保证只跑一次）。 */
  const Panel = (): unknown => {
    const [phase, setPhase] = React.useState<'running' | 'done'>('running')
    const started = React.useRef(false)

    React.useEffect(() => {
      if (started.current) return
      started.current = true
      void launcher.launch().then(() => setPhase('done'))
    }, [])

    const link = React.createElement(
      'a',
      {
        key: 'manual',
        href: DEFAULTS.targetUrl,
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
      React.createElement('div', { key: 'message' }, phase === 'running' ? '正在播放过场…' : '已在新标签页打开 PosterFlow'),
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

/** 内联视频的字节数（诊断/测试用）。 */
export const INLINED_VIDEO_BYTES = TRANSITION_VIDEO_BYTES
