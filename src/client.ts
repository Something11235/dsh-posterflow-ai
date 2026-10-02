/**
 * dsh-posterflow-ai —— client 半边（浏览器）。
 *
 * 形态：**惰性 CJS 表**。文件被 `<script>` 执行时只调用
 * `window.__ModuleLoader__.load({ id, factory })` 注册工厂；真正的模块体
 * （副作用、组件定义）都在 factory 闭包内，首次 require 时才 materialize。
 * 这条契约在本机用 `scripts/verify-client-bundle.mjs` 对着真实产物验证过。
 *
 * 为什么不用 import：这个文件**不能有任何构建期依赖**。它唯一需要的 React
 * 由注入的 `require` 从模块表取（`require('react')`），其余能力来自
 * `apply(ctx)` 收到的 client 端 ctx（这里只用到 `ctx.slots`）。
 */
interface ClientBundleRegistration {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

interface ModuleLoaderTarget {
  load(registration: ClientBundleRegistration): void
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

/** 只声明用到的那部分 DOM/全局，避免依赖 DOM lib。 */
declare const window: {
  __ModuleLoader__: ModuleLoaderTarget
  open(url: string, target?: string, features?: string): unknown
  location: { assign(url: string): void }
}
declare const document: {
  createElement(tag: string): DomNode
  body: DomNode
}

/** 注入的 React（模块表里的基线库）。只声明用到的成员。 */
interface ReactLike {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  useState<T>(initial: T): [T, (next: T) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}

/** 宿主通过 `ctx.slots` 暴露的客户端 Slot 服务（只声明用到的方法）。 */
interface ClientContext {
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(options: {
      name: string
      id: string
      order?: number
      label?: string | (() => string)
    }, component: unknown): () => void
  }
}

interface ClientConfig {
  targetUrl: string
  buttonLabel: string
  openIn: 'new-tab' | 'same-tab'
  transition: 'video' | 'none'
  videoUrl: string
  muted: boolean
  maxWaitMs: number
}

window.__ModuleLoader__.load({
  id: 'dsh-posterflow-ai',
  factory: (require) => {
    const React = require('react') as ReactLike

    /** 与宿主 Config 的默认值保持一致；路由读不到时用它们兜底。 */
    const DEFAULTS: ClientConfig = {
      targetUrl: 'https://www.posterflow-ai.xyz/',
      buttonLabel: '开启生图模式',
      openIn: 'new-tab',
      transition: 'video',
      videoUrl: '/posterflow-ai/transition.webm',
      muted: true,
      maxWaitMs: 8000,
    }

    let cached: ClientConfig | undefined

    /** 读宿主配置；任何失败都用默认值兜底，绝不因此让按钮失灵。 */
    const loadConfig = async (): Promise<ClientConfig> => {
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
    }

    /** 跳转；`new-tab` 被浏览器拦下时降级为当前页跳转。 */
    const openTarget = (config: ClientConfig): void => {
      if (config.openIn === 'same-tab') {
        window.location.assign(config.targetUrl)
        return
      }
      const opened = window.open(config.targetUrl, '_blank', 'noopener,noreferrer')
      if (opened === null || opened === undefined) window.location.assign(config.targetUrl)
    }

    /** 播放过场视频；结束、出错、超时、或用户点击画面都会立刻放行。 */
    const playTransition = (config: ClientConfig): Promise<void> =>
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
      })

    /** 侧栏底部的按钮。owner 会传 `wide`（false = 56px 折叠栏）。 */
    const Action = (props: { wide?: boolean }): unknown => {
      const wide = props.wide === true
      const [label, setLabel] = React.useState(DEFAULTS.buttonLabel)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        void loadConfig().then((config) => {
          if (alive) setLabel(config.buttonLabel)
        })
        return () => {
          alive = false
        }
      }, [])

      const onClick = (): void => {
        if (busy) return
        setBusy(true)
        void (async () => {
          const config = await loadConfig()
          if (config.transition === 'video') await playTransition(config)
          openTarget(config)
        })().finally(() => setBusy(false))
      }

      return React.createElement(
        'button',
        {
          type: 'button',
          onClick,
          disabled: busy,
          title: label,
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: wide ? 'flex-start' : 'center',
            gap: '6px',
            width: wide ? '100%' : '32px',
            padding: wide ? '6px 10px' : '6px 0',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: '8px',
            background: 'transparent',
            color: busy ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-primary)',
            cursor: busy ? 'progress' : 'pointer',
            font: 'inherit',
            fontSize: '12px',
            opacity: busy ? '0.6' : '1',
          },
        },
        wide ? `🖼 ${label}` : '🖼',
      )
    }

    const apply = (ctx: ClientContext): void => {
      // inject → 等 Slot 声明就绪再注册；注册进未声明的 Slot 会静默不渲染。
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'posterflow-ai',
            order: 20,
            label: () => DEFAULTS.buttonLabel,
          },
          Action,
        ),
      )
    }

    return { name: 'posterflow-ai', inject: ['slots'], apply }
  },
})

/**
 * `export {}` 只为满足 `isolatedModules`：没有 import/export 的文件会被 TS 当成
 * "全局脚本"，在 isolatedModules 下直接报 TS1208。
 * 它是**类型层**的导出，构建后不会产生任何 `exports` 引用；client 产物用 IIFE 形态，
 * 仍然是外壳可以直接 `<script>` 加载的普通脚本（由 scripts/verify-client-bundle.mjs 把关）。
 */
export {}
