/**
 * client 半边的实现（可测试的模块层）。
 *
 * 为什么把逻辑放在这里而不是直接写在 `client.ts` 里：
 * `client.ts` 必须是"执行即注册工厂"的脚本形态，没法被测试导入。
 * 抽成模块后：① 注册契约、闸门、开窗逻辑可单测；② 构建时会 inline 进 `lib/client.js`。
 *
 * 三个踩坑后的关键设计（都来自本机实测）：
 *  1. **视频内联**：桌面版 GUI（19387）不是 `ctx.webServer` 的路由面（连内核自己的 `/plugins/...` 都 404），
 *     走路由必然播不出视频，所以把视频做成 data URI 带在产物里。
 *  2. **开窗绝不用返回值判断"被拦截"**：DSH 桌面版的 Electron 主进程里，
 *     `setWindowOpenHandler` 永远返回 `{action:'deny'}` 并且顺手 `shell.openExternal(url)`——
 *     于是任何 `window.open` 都返回 `null`，但网站**已经被宿主用系统浏览器打开了一次**。
 *     老代码把 `null` 当"被拦"又对当前页 `location.assign()`，于是新标签页 + 当前页各打开一次。
 *     现在返回 `blocked` 时**不导航**，只让面板提示用户点手动链接。
 *  3. **去重窗口要跨挂载**：React 严格模式 / slot 重注册都可能导致面板重新挂载，
 *     而重新挂载时 `useEffect` 会再跑一次。旧的 1.5 秒窗口挡不住"间隔几秒的重挂载"，
 *     所以去重窗口放大到 `LAUNCH_DEDUPE_MS`，并且状态放在**模块级共享**的 launcher 里。
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
  muted: false, // 默认带声音；被自动播放策略拒绝时才降级静音并给「开启声音」按钮
  maxWaitMs: 8000,
}

/**
 * 去重窗口：这段时间内的重复触发一律忽略。
 * 必须显著大于视频时长，否则"面板重新挂载"会在视频播完后再次触发一次跳转。
 */
export const LAUNCH_DEDUPE_MS = 20_000

/** 具名窗口：普通浏览器里同名标签页会被复用（DSH 桌面版因为宿主 deny 而不适用）。 */
export const WINDOW_NAME = 'posterflow-ai-launch'

/** 侧栏主列表那一行的 id，同时也是 `main` 面板的 key。 */
export const PANEL_ID = 'posterflow-ai'
/** 侧栏主列表（「插件」「自动化任务」所在的那一列）。 */
export const SLOT_PANEL_LIST = 'sidebar.panellist'
/** 主面板 keyed 槽，承载过场与跳转。 */
export const SLOT_MAIN = 'main'
/** 排在最后一行：既有的 plugins = 0、schedules = 10。 */
export const PANEL_ORDER = 100

/**
 * 诊断计数。用途是把"到底哪一层被跑了两次"变成用户能直接读到的数字：
 * 面板上会显示 触发/apply/effect/渲染 各自的次数，一眼就能区分
 * 「apply 两次」「Panel 渲染两次」「effect 跑两次」「launch 被放行两次」。
 */
export interface Diagnostics {
  applies: number
  panelRenders: number
  effects: number
  launches: number
  opens: number
  blocked: number
}

/** 模块级诊断计数（生产环境跨挂载累计）。 */
export const diagnostics: Diagnostics = { applies: 0, panelRenders: 0, effects: 0, launches: 0, opens: 0, blocked: 0 }

/** 重置诊断计数（测试用）。 */
export function resetDiagnostics(): void {
  diagnostics.applies = 0
  diagnostics.panelRenders = 0
  diagnostics.effects = 0
  diagnostics.launches = 0
  diagnostics.opens = 0
  diagnostics.blocked = 0
}

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

/** 一次跳转尝试的结果。 */
export interface OpenOutcome {
  /** `opened` = 拿到了窗口句柄；`blocked` = 宿主/浏览器拦下；`same-tab` = 当前页导航。 */
  kind: 'opened' | 'blocked' | 'same-tab'
  /** 是否拿到窗口句柄。DSH 桌面版**永远**是 false（宿主 deny + openExternal）。 */
  handleReturned: boolean
}

/** 副作用实现，可在 Node 里替换以便单测。 */
export interface LaunchRuntime {
  loadConfig: () => Promise<ClientConfig>
  playTransition: (config: ClientConfig) => Promise<void>
  openTarget: (config: ClientConfig) => OpenOutcome
  /** 可注入的时钟，便于测去重窗口。 */
  now?: () => number
}

/** 一次 launch 的结果。 */
export interface LaunchOutcome {
  /** 是否真的执行了（false = 被闸门挡下）。 */
  ran: boolean
  /** 被挡下的原因。 */
  reason?: 'in-flight' | 'deduped'
  /** 执行时的跳转结果。 */
  open?: OpenOutcome
}

/** 一次「过场 → 跳转」的编排。 */
export interface Launcher {
  launch(): Promise<LaunchOutcome>
  running(): boolean
}

/**
 * 创建编排器（去重 + 进行中闸门）。
 *
 * @param runtime - 副作用实现（可注入替身）。
 * @returns 编排器。
 */
export function createLauncher(runtime: LaunchRuntime): Launcher {
  const now = runtime.now ?? ((): number => Date.now())
  let lastRanAt = Number.NEGATIVE_INFINITY
  let inFlight = false

  return {
    running: () => inFlight,
    async launch(): Promise<LaunchOutcome> {
      const at = now()
      if (inFlight) return { ran: false, reason: 'in-flight' }
      if (at - lastRanAt < LAUNCH_DEDUPE_MS) return { ran: false, reason: 'deduped' }
      inFlight = true
      lastRanAt = at
      diagnostics.launches += 1
      try {
        const config = await runtime.loadConfig()
        if (config.transition === 'video') await runtime.playTransition(config)
        diagnostics.opens += 1
        const open = runtime.openTarget(config)
        if (open.kind === 'blocked') diagnostics.blocked += 1
        return { ran: true, open }
      } finally {
        inFlight = false
      }
    },
  }
}

/** 可注入的窗口面（方便单测开窗逻辑）。 */
export interface WindowLike {
  open(url: string, target?: string, features?: string): unknown
  location: { assign(url: string): void }
}

/**
 * 创建「跳转」实现。
 *
 * **关键：`null` 不是"失败"，也不该降级导航。** 在 DSH 桌面版里，
 * Electron 主进程对任何 `window.open` 都返回 `deny` 并顺手 `shell.openExternal(url)`，
 * 所以这里必然拿到 `null`，而网站**已经被打开过一次**。此时若再 `location.assign()`，
 * 就会出现"打开两次"（新标签页 + 当前页）。
 *
 * 因此：`new-tab` 路径**只调用一次 `window.open`**，拿到 `null` 就返回 `blocked`，
 * 由面板提示用户点手动链接；只有显式的 `same-tab` 配置才会导航当前页。
 *
 * @param win - 窗口对象（默认 `window`）。
 * @returns 跳转函数。
 */
export function createOpenTarget(win: WindowLike): (config: ClientConfig) => OpenOutcome {
  return (config: ClientConfig): OpenOutcome => {
    if (config.openIn === 'same-tab') {
      win.location.assign(config.targetUrl)
      return { kind: 'same-tab', handleReturned: false }
    }

    const opened = win.open(config.targetUrl, WINDOW_NAME) as
      | { opener?: unknown; focus?: () => void }
      | null
      | undefined

    if (opened === null || opened === undefined) {
      // 不导航！宿主很可能已经打开过了（见函数注释）
      return { kind: 'blocked', handleReturned: false }
    }

    try {
      opened.opener = null
    } catch {
      /* 跨源时可能不可写，忽略 */
    }
    try {
      opened.focus?.()
    } catch {
      /* 忽略 */
    }
    return { kind: 'opened', handleReturned: true }
  }
}

/** 可覆盖的副作用实现。 */
export type PanelRuntime = Partial<LaunchRuntime>

interface DomNode {
  style: Record<string, string>
  textContent: string
  title: string
  setAttribute(name: string, value: string): void
  appendChild(child: unknown): void
  addEventListener(type: string, listener: (event?: { stopPropagation?: () => void }) => void): void
  remove(): void
}

interface VideoNode extends DomNode {
  src: string
  autoplay: boolean
  muted: boolean
  volume: number
  playsInline: boolean
  play(): Promise<void> | undefined
}

// 只声明用到的那部分浏览器全局（本包的 tsconfig 不含 DOM lib）
declare const fetch: (input: string, init?: { cache?: string }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>
declare const window: WindowLike
declare const document: {
  createElement(tag: string): DomNode
  body: DomNode
}
declare const console: { log(...args: unknown[]): void }

/** 生产环境共享同一个编排器：跨挂载/跨注册都只认一份去重状态。 */
let sharedLauncher: Launcher | undefined

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

  const openTarget = runtime.openTarget ?? createOpenTarget(window)

  /** 视频地址：默认用内联的 data URI，部署方显式要求 route 时才走宿主路由。 */
  const videoSourceFor = (config: ClientConfig): string =>
    config.videoSource === 'route' && config.videoUrl !== '' ? config.videoUrl : TRANSITION_VIDEO_DATA_URI

  /**
   * 播放过场视频，**铺满整个窗口**。
   *
   * 声音策略：先按配置尝试（默认 `muted: false`）。被自动播放策略拒绝时退化为静音起播，
   * 并在右上角给一个「开启声音」按钮（那一下是用户手势，必定能取消静音）。
   * 结束 / 出错 / 超时 / 点击画面都会立刻放行。
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

        const wantsSound = config.muted === false
        let soundButton: DomNode | undefined

        /**
         * 底部居中的「开启声音」提示。
         * 只在"带声音起播被自动播放策略拒绝"时才出现；点它是用户手势，必定能出声。
         */
        const showSoundButton = (): void => {
          if (soundButton !== undefined) return
          const button = document.createElement('button')
          button.textContent = '🔊 点击开启声音'
          button.title = '浏览器拒绝了带声音的自动播放，点这里开启'
          button.setAttribute('type', 'button')
          Object.assign(button.style, {
            position: 'absolute',
            bottom: '28px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: '1',
            padding: '10px 20px',
            border: '1px solid rgba(255,255,255,0.4)',
            borderRadius: '999px',
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            font: 'inherit',
            fontSize: '14px',
            cursor: 'pointer',
          })
          button.addEventListener('click', (event) => {
            event?.stopPropagation?.() // 别触发"点击跳过"
            video.muted = false
            video.volume = 1
            button.remove()
            soundButton = undefined
          })
          soundButton = button
          try {
            overlay.appendChild(button)
          } catch {
            /* 忽略 */
          }
        }

        /** 播放真正开始后若仍有声音需求，就再解除一次静音（此时文档已有用户手势）。 */
        video.addEventListener('playing', () => {
          if (wantsSound && video.muted) {
            video.muted = false
            video.volume = 1
          }
        })

        const startPlayback = (): void => {
          const played = video.play()
          if (played !== undefined && typeof played.catch === 'function') {
            played.catch(() => {
              // 带声音起播被策略拒绝 → 静音重试（保证画面一定播出来），并给出开启声音的入口
              video.muted = true
              const retry = video.play()
              if (retry !== undefined && typeof retry.catch === 'function') retry.catch(finish)
              if (wantsSound) showSoundButton()
            })
          }
        }

        video.muted = config.muted
        video.volume = 1
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
        startPlayback()
      }))

  const builtRuntime: LaunchRuntime = {
    loadConfig,
    playTransition,
    openTarget,
    ...(runtime.now === undefined ? {} : { now: runtime.now }),
  }

  // 单测注入替身时每次新建（用例之间互不影响）；生产环境全模块共享一份。
  const injected =
    runtime.loadConfig !== undefined || runtime.playTransition !== undefined || runtime.openTarget !== undefined
  const launcher = injected ? createLauncher(builtRuntime) : (sharedLauncher ??= createLauncher(builtRuntime))

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
   * 主面板：挂载即启动编排（共享闸门保证一次点击只跑一次）。
   *
   * UI 上**只保留两行**：标题 + 手动链接。诊断计数改为只写 `console`，
   * 需要时在 DSH 窗口按 Ctrl+Shift+I 看 `[posterflow-ai]` 即可。
   */
  const Panel = (): unknown => {
    diagnostics.panelRenders += 1
    const started = React.useRef(false)

    React.useEffect(() => {
      diagnostics.effects += 1
      if (started.current) return
      started.current = true
      void launcher.launch().then((outcome) => {
        console.log('[posterflow-ai] launch outcome', outcome, diagnostics)
      })
    }, [])

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
        '🖼 已开启',
      ),
      React.createElement(
        'a',
        {
          key: 'manual',
          href: DEFAULTS.targetUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          style: { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'underline' },
        },
        '手动打开 PosterFlow',
      ),
    )
  }

  const apply = (ctx: ClientContext): void => {
    diagnostics.applies += 1

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
