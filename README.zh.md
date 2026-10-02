# dsh-posterflow-ai

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：在 Web 界面侧栏底部放一个「**开启生图模式**」按钮，点下去先播放一段过场视频，再跳转到 [PosterFlow](https://www.posterflow-ai.xyz/)。

> English version: [README.md](./README.md)

## 它长什么样

```
侧栏底部（Settings 旁边）
┌──────────────────────────┐
│  🖼 开启生图模式           │  ← 点击
└──────────────────────────┘
        ↓
  全屏黑底播放过场视频（assets/transition.webm）
  结束 / 出错 / 超时 / 点击画面 → 立即继续
        ↓
  打开 https://www.posterflow-ai.xyz/（默认新标签页）
```

## 安装

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

> **桌面版注意**：`desktop` profile 由 Electron 应用独占，CLI 会拒绝操作它
> （`profile "desktop" is managed exclusively by the Electron application`）。
> 桌面版请改用应用内的「设置 → 插件」界面安装，或手工改
> `$DSH_HOME/profiles/desktop/` 下的 `package.json` 与 `cordis.patch.yml`，然后重启应用。
> **改完必须重启**：`dsh.client` 声明的扫描结果（包括"这不是 client 包"的否定结论）会缓存到重启。

## 配置

在你自己 profile 的 `cordis.patch.yml` 里按行 `id` 覆盖。注意 `config` 是**整行替换**、不是深合并——
没写的字段回落到 schema 默认值。

```yaml
- id: dsh-posterflow-ai
  name: dsh-posterflow-ai
  config:
    targetUrl: https://www.posterflow-ai.xyz/
    buttonLabel: 开启生图模式
    openIn: new-tab        # 或 same-tab
    transition: video      # 或 none（点击后直接跳转）
    videoFile: assets/transition.webm
    muted: true
    maxWaitMs: 8000
```

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `targetUrl` | string | `https://www.posterflow-ai.xyz/` | 过场结束后跳转的地址 |
| `buttonLabel` | string | `开启生图模式` | 按钮文案 |
| `openIn` | `new-tab` \| `same-tab` | `new-tab` | 新标签页打开（不会丢掉当前会话界面）或当前页跳转 |
| `transition` | `video` \| `none` | `video` | 是否播放过场视频 |
| `videoFile` | string | `assets/transition.webm` | 过场视频在**包内**的相对路径 |
| `muted` | boolean | `true` | 视频是否静音（静音是自动播放的唯一可靠保证） |
| `maxWaitMs` | integer 0–60000 | `8000` | 视频最长等待；超时直接跳转，不让用户卡在过场里 |

## 它是怎么工作的（两层）

这是一个**双面插件**，两个半边各司其职：

| 半边 | 产物 | 做什么 |
| --- | --- | --- |
| 宿主（Node） | `lib/index.js` | 注册两条 HTTP 路由：把**过场视频**按需发给浏览器（支持 Range/206/416/HEAD），以及把**部署期配置**以 JSON 递给浏览器 |
| 浏览器 | `lib/client.js` | 惰性 CJS 表：注册 `sidebar.footer.action` 里的按钮，点击后取配置 → 播视频 → 跳转 |

三个值得说明的取舍：

1. **视频走路由，不内联进 JS。** 视频 2.66 MiB，base64 内联会让 client bundle 涨到 ~3.6 MB 并在每次页面启动时下载。
   走 `ctx.webServer.register({ kind: 'exact', path: '/posterflow-ai/transition.webm' })` 之后，浏览器只在真正要播时才拉它，
   而且 `Range` 请求能得到 206（视频 seek 依赖这个）。
2. **client 半边读不到宿主的 `Config`**，所以宿主用 `/posterflow-ai/config.json` 把它递过去。
   这条路由是 `Cache-Control: no-store`，改配置重启即生效。client 侧读取失败时回落到内置默认值，**绝不因此让按钮失灵**。
3. **不 `inject: ['webServer']`。** 用 `ctx.get('webServer')` 读取并降级：这样插件在 headless 之类的 profile 里
   也能正常加载（只是不注册路由），而不是因为依赖缺失一直等在那里。浏览器半边本来就只存在于 Web 界面。

按钮注册进 `sidebar.footer.action`（list / root scope，`{id, order, label}`），
`order: 20`，与既有的 `cordis-panel`、dsh-context 的 `context-overview` 共存。
折叠成 56px 窄栏时只显示图标（owner 会传 `wide: false`）。

## 开发

```sh
pnpm install
pnpm run typecheck && pnpm run lint && pnpm run test
pnpm run build
pnpm run test:artifact   # 宿主产物：真 WebServer 上真发 HTTP 请求
pnpm run test:client     # 浏览器产物：惰性 CJS 契约（纯 Node，无需浏览器）
```

### 六道质量门

| 门 | 覆盖什么 |
| --- | --- |
| `typecheck` | 严格 TS，含 client 半边的惰性 CJS 形态 |
| `lint` | oxlint |
| `test` | **23 个用例**：`tests/route.test.ts` 纯逻辑（Range 解析、路径逃逸防护）；`tests/webserver.test.ts` **真 WebServer + 真 HTTP 请求** |
| `build` | tsdown 产出 `lib/index.js`（ESM）+ `lib/client.js`（IIFE 普通脚本） |
| `test:artifact` | 构建产物挂真 WebServer，真请求验证路由可用、卸载即撤 |
| `test:client` | 在 Node 里执行 `lib/client.js`：**执行期 0 次模块请求、0 次 DOM 变更**（证明惰性契约），materialize 后导出 `name/inject/apply` |

`tests/webserver.test.ts` 里最值得看的是这几条：Range 返回 206 且首 4 字节是 WebM 的 EBML 魔数、越界 Range 返回 416、
`HEAD` 只回头、`videoFile` 试图逃出包目录时**拒绝注册**（配置是可信输入，但不该给配置留读任意文件的口子）。

## 已知限制

- **只支持 Web 界面。** 浏览器半边只在 Web 外壳里加载；`desktop`/headless 里只有宿主半边（不会注册路由）。
- **改 `dsh.client` 声明需要重启**（扫描结果缓存到重启）；只有产物字节变化能在线生效。
- 过场视频是**内置资源**，不能填任意 HTTP 地址（`videoFile` 被限制在包目录内）。
- 按钮位置固定为侧栏底部；要换挂载点改 `src/client.ts` 里的 Slot key 即可
  （可用挂载点见参考工作区的 `reference/live-slot-catalog.md`，共 90 个）。

## 许可

MIT
