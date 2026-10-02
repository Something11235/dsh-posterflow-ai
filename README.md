# dsh-posterflow-ai

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：在 Web 界面侧栏加一个「**开启生图模式**」入口，点击后**铺满整个窗口**播放一段过场动画，然后跳转到 [PosterFlow](https://www.posterflow-ai.xyz/)。

> English: [README.en.md](./README.en.md)

## 它长什么样

```
侧栏 —— 排在「插件」「自动化任务」下面，最后一行
  ┌────────────────────────────┐
  │  ＋   新会话                 │
  ├────────────────────────────┤
  │  ◇   插件                   │
  │  🕘   自动化任务              │
  │  🖼   开启生图模式    ← 新增  │
  └────────────────────────────┘
        ↓ 点击
  过场动画铺满整个 DSH 窗口（object-fit: cover）
  结束 / 出错 / 超时 / 点击画面 → 立即继续
        ↓
  打开 https://www.posterflow-ai.xyz/（默认新标签页）
```

面板上只保留两行文字：**生图模式已开启** 与 **手动打开 PosterFlow**。诊断信息只写控制台
（DSH 窗口按 `Ctrl+Shift+I`，过滤 `[posterflow-ai]`），界面上不显示。

## 安装

三种方式，按"对方环境"挑：

| 方式 | 地址 / 命令 | 需要 `git` | 说明 |
| --- | --- | --- | --- |
| Git 仓库 | `github:Something11235/dsh-posterflow-ai#main` | **需要** | 当前推荐；界面里粘这个地址 |
| npm 包名 | `dsh-posterflow-ai` | 不需要 | 需先发布到 npm（尚未发布） |
| 本地包 | 指向本地目录 / `.tgz` | 不需要 | 内网、无 git 的机器用这个 |

> **安装失败排查**
>
> - 报 `'git' 不是内部或外部命令`（或 `Command failed with exit code 1: git ls-remote ...`）
>   → **那台机器没装 Git 或 Git 不在 PATH**。`pnpm add github:...` 必须调用 `git ls-remote` 解析仓库。
>   装 [Git for Windows](https://git-scm.com/download/win) 后**完全退出 DSH 再打开**重试；
>   或者改用 npm 包名 / 本地包安装（都不需要 git）。
> - 报 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`
>   → 该 git 依赖的 `package.json` 里有 `prepare` 脚本。本插件**没有** `prepare`，且 `lib/` 已随仓库提交。
> - 界面装完按钮不出现
>   → `dsh.client` 声明的扫描结果会缓存：必须**完全退出应用**（托盘退出）再启动。
> - 报代理相关错误（`ECONNREFUSED 127.0.0.1:65532`）
>   → 那是 `~/.npmrc` 里的失效代理；pnpm 不会向上层目录找 `.npmrc`，请在**profile 目录**里放一份
>     `.npmrc`（`proxy=` / `https-proxy=`）或修掉全局代理设置。

```sh
# 从 GitHub 安装（推荐，会被社区市场自动收录）
dsh plugin --profile web add "github:Something11235/dsh-posterflow-ai#main"

# 本地开发
dsh plugin --profile plugindev add link:/绝对/路径/dsh-posterflow-ai
```

确认组合树：

```sh
dsh --profile plugindev --dump-config | grep -A10 'dsh-posterflow-ai'
```

> **桌面版注意**：`desktop` profile 由 Electron 应用独占，CLI 会拒绝操作它。
> 桌面版请用应用内「设置 → 插件 → 添加插件」粘贴仓库地址安装，然后**完全退出应用再打开**
> （`dsh.client` 声明的扫描结果会缓存到重启）。

## 配置

在你自己 profile 的 `cordis.patch.yml` 里按行 `id` 覆盖。`config` 是**整行替换**、不是深合并——没写的字段回落到 schema 默认值。

```yaml
- id: dsh-posterflow-ai
  name: dsh-posterflow-ai
  config:
    targetUrl: https://www.posterflow-ai.xyz/
    buttonLabel: 开启生图模式
    openIn: new-tab        # 或 same-tab
    transition: video      # 或 none（点击后直接跳转）
    videoSource: inline    # 或 route
    muted: true
    maxWaitMs: 8000
```

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `targetUrl` | string | `https://www.posterflow-ai.xyz/` | 过场结束后跳转的地址 |
| `buttonLabel` | string | `开启生图模式` | 按钮文案 |
| `openIn` | `new-tab` \| `same-tab` | `new-tab` | 新标签页打开（不会丢掉当前会话界面）或当前页跳转 |
| `transition` | `video` \| `none` | `video` | 是否播放过场视频 |
| `videoSource` | `inline` \| `route` | `inline` | `inline` = 用产物内联的视频（**一定能播**）；`route` = 用宿主 HTTP 路由（仅在页面确由 `ctx.webServer` 提供服务时有效） |
| `videoFile` | string | `assets/transition.webm` | `route` 模式下要提供的包内文件 |
| `muted` | boolean | `false` | 默认**带声音**；被浏览器自动播放策略拒绝时自动降级为静音，并在画面右上角给出「开启声音」按钮 |
| `maxWaitMs` | integer 0–60000 | `8000` | 视频最长等待；超时直接跳转，不让用户卡在过场里 |

## 它是怎么工作的（两层）

这是一个**双面插件**：

| 半边 | 产物 | 做什么 |
| --- | --- | --- |
| 宿主（Node） | `lib/index.js` | 只注册一条配置路由，把部署期配置以 JSON 递给浏览器（另保留一条可选视频路由给 `videoSource: route`） |
| 浏览器 | `lib/client.js` | 惰性 CJS 表，注册**两处**：侧栏主列表最后一行（`sidebar.panellist`，order 100）与同 id 的主面板（`main` keyed `posterflow-ai`），由后者播放内联过场并跳转 |

六个值得说明的取舍：

1. **侧栏那一行不是普通按钮槽。** `sidebar.panellist` 的每个 id 对应**一个主面板**——「插件」「自动化任务」就是
   `plugins`(order 0) 与 `schedules`(order 10)。侧栏自己渲染按钮、从注册元数据取 `label`，
   我们的组件只负责**图标**（owner props 只有 `size` / `active`）。所以点这一行会切到同 id 的面板：
   我们同时注册 `main` keyed `posterflow-ai` 来承载「过场 → 跳转」，并用 order 100 排在最后一行。
2. **视频内联在产物里（默认），不依赖任何 HTTP 路由。** 这是踩坑后的修正：桌面版 GUI 的
   `127.0.0.1:19387` **不是** `ctx.webServer` 的路由面——实测连内核自己的 `/plugins/...` 都返回 404，
   所以"宿主注册路由、页面去取"这条路在桌面版走不通，视频必然加载失败并立刻放行跳转
   （表现就是"完全没有播放视频"）。
   现在源片先用 ffmpeg 压到 **1080 宽 / CRF 48 / 24fps / 24kbps 单声道**（2.66 MiB → **458 KB**），
   再由 [`scripts/embed-video.mjs`](scripts/embed-video.mjs) 生成 data URI 内联进 `lib/client.js`（产物约 **659 KB**）。
   换来的是**一定能播**：不依赖端口、协议、CORS 或路由。
3. **过场铺满整个窗口。** 覆盖层 `position: fixed; inset: 0` + 视频 `width/height: 100%`、`object-fit: cover`，
   所以是整窗填充而不是居中带黑边的信箱式播放。默认**带声音**起播（`muted: false`）；
   若带声音起播被自动播放策略拒绝，则静音重试保证画面一定播出来，
   同时在画面底部居中给出「🔊 点击开启声音」——那一下是用户手势，必定能出声。
   另外内联的短片用 ffmpeg `loudnorm` 把音轨规整到约 **−15 dB**（原始只有 −25 dB，偏轻到容易以为"没声音"）。
4. **一次点击只跑一次，而且只开一个标签页。** 这条踩了两轮坑，最终结论：
   - **DSH 桌面版的 Electron 主进程对任何 `window.open` 都返回 `deny`，并顺手 `shell.openExternal(url)`**
     （见 `app.asar/lib/main.js`）。所以桌面版里 `window.open` **必然返回 `null`**，而网站**已经被宿主用系统浏览器打开过一次**。
     老代码把 `null` 当"被拦截"又对当前页 `location.assign()` → 新标签页与当前页各打开一次。
     现在 `null` 只记为 `blocked`，**绝不自动导航**，改由面板提示用户点手动链接。
   - 去重窗口从 1.5 秒放大到 **20 秒**（`LAUNCH_DEDUPE_MS`）：面板可能被重新挂载（React 严格模式 / slot 重注册），
     而 1.5 秒挡不住"过场播完（约 6.5 秒）后再挂载一次"。
   - `new-tab` 路径**只调用一次 `window.open`**（具名窗口 + 打开后手动把 `opener` 置空）。
   诊断计数（`触发 / apply / effect / 渲染 / 被拦`）仍然在维护，但**只写控制台**，界面上不显示。
   测试：[`tests/launcher.test.ts`](tests/launcher.test.ts)、[`tests/open-target.test.ts`](tests/open-target.test.ts)（含"返回 null 不导航"）、
   [`tests/panel-ui.test.ts`](tests/panel-ui.test.ts)（面板只有两行）。
5. **client 半边读不到宿主的 `Config`**，所以宿主用 `/posterflow-ai/config.json` 把它递过去
   （`Cache-Control: no-store`）。client 侧读取失败时回落到内置默认值，而默认值就是"内联视频"，
   所以**入口永远不会因为路由不通而失灵**。
6. **不 `inject: ['webServer']`。** 用 `ctx.get('webServer')` 读取并降级，这样插件在 headless 之类的
   profile 里也能正常加载（只是不注册路由），而不是因为依赖缺失一直等在那里。

## 开发

```sh
pnpm install
pnpm run embed           # 由 assets/transition.webm 生成内联 data URI 模块
pnpm run typecheck && pnpm run lint && pnpm run test
pnpm run build
pnpm run test:artifact   # 宿主产物：真 WebServer 上真发 HTTP 请求
pnpm run test:client     # 浏览器产物：惰性 CJS 契约（纯 Node，无需浏览器）
```

### 七道质量门

| 门 | 覆盖什么 |
| --- | --- |
| `verify:embed` | 内联视频模块与 `assets/transition.webm` 一致（防止改了视频忘了重新生成） |
| `typecheck` | 严格 TS，含 client 半边的惰性 CJS 形态 |
| `lint` | oxlint（生成的视频模块已排除） |
| `test` | **55 个用例**，六个文件：纯逻辑（Range 解析、路径逃逸防护）、注册契约（最后一行 + 同 id 主面板）、面板 UI（只有两行）、编排去重（20 秒窗口 / 进行中 / 诊断计数 / 声音判定）、开窗（只开一次、`null` 不导航）、真 WebServer + 真 HTTP 请求 |
| `build` | tsdown 产出 `lib/index.js`（ESM）+ `lib/client.js`（IIFE 普通脚本，约 659 KB） |
| `test:artifact` | 构建产物挂真 WebServer：路由可用、卸载即撤 |
| `test:client` | 在 Node 里执行 `lib/client.js`：执行期 **0 次模块请求、0 次 DOM 变更**（惰性契约），materialize 后导出 `name/inject/apply` |

## 已知限制

- **只支持 Web 界面。** 浏览器半边只在 Web 外壳里加载；`desktop`/headless 里只有宿主半边。
- **改 `dsh.client` 声明需要重启**（扫描结果缓存到重启）；只有产物字节变化能在线生效。
- **过场视频是构建期内联的**，改视频要重新跑 `pnpm run embed` 并重新构建（`verify:embed` 会在 CI 里拦住不同步）。
- **跳转走外部浏览器**（默认新标签页）。"跳进 DSH 内置浏览器"需要 `sidebarRightTabs` 服务的契约，
  该包未随包发布类型定义，目前**未实现**。
- 入口固定在侧栏主列表**最后一行**（`PANEL_ORDER = 100`）。要挪位置改这个 order，或换成
  `sidebar.footer.action` 这类按钮槽（那时只需注册一处）。可用挂载点见参考工作区的 `reference/live-slot-catalog.md`（90 个）。

## 许可

MIT
