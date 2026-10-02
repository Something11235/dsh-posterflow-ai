# dsh-posterflow-ai

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin: a **PosterFlow launcher** in the Web sidebar. Click **开启生图模式**, watch a transition animation that **fills the whole window**, then land on [PosterFlow](https://www.posterflow-ai.xyz/).

> 中文文档（默认）：[README.md](./README.md)

## What it does

```
sidebar — below 插件 / 自动化任务, as the last row
  ┌────────────────────────────┐
  │  ＋   New session            │
  ├────────────────────────────┤
  │  ◇   Plugins                 │
  │  🕘   Scheduled tasks         │
  │  🖼   开启生图模式    ← added │
  └────────────────────────────┘
        ↓ click
  transition animation fills the entire DSH window (object-fit: cover)
  ended / errored / timed out / clicked → continue immediately
        ↓
  open https://www.posterflow-ai.xyz/ (new tab by default)
```

The panel keeps exactly two lines of text: **生图模式已开启** and **手动打开 PosterFlow**. Diagnostics go to the
console only (`Ctrl+Shift+I` in the DSH window, filter `[posterflow-ai]`) and are not shown in the UI.

## Install

Three ways — pick by the target machine:

| Way | Address / command | Needs `git` | Notes |
| --- | --- | --- | --- |
| **Source archive** | GitHub → **Code → Download ZIP** | **no** | The repo ships the built `lib/`, so extracting is enough — **no Node, no build** (verified) |
| Git repo | `github:Something11235/dsh-posterflow-ai#main` | **yes** | Easiest when git exists; paste this into the app |
| npm package | `dsh-posterflow-ai` | no | **After publishing, anyone just types the name** (see “Publishing to npm” below) |
| Local package | path to a local dir / `.tgz` | no | For machines without git |

> **Install troubleshooting**
>
> - `'git' is not recognized as an internal or external command`
>   (or `Command failed with exit code 1: git ls-remote ...`)
>   → **that machine has no Git, or Git is not on PATH.** `pnpm add github:...` must run `git ls-remote`
>   to resolve the repo. Install [Git for Windows](https://git-scm.com/download/win), **fully quit DSH**,
>   reopen and retry — or use the npm / local-package route, neither of which needs git.
> - `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`
>   → that git dependency has a `prepare` script. This plugin has **no** `prepare`, and `lib/` is committed.
> - The entry does not show up after installing
>   → `dsh.client` scan results are cached: **fully quit the app** (tray → quit) and start it again.
> - Proxy errors (`ECONNREFUSED 127.0.0.1:65532`)
>   → a dead proxy in `~/.npmrc`; pnpm does not walk up for `.npmrc`, so put one in the **profile directory**
>     (`proxy=` / `https-proxy=`).

### On a machine without git (verified end to end)

1. Open https://github.com/Something11235/dsh-posterflow-ai → **Code → Download ZIP**
   (or fetch `https://github.com/Something11235/dsh-posterflow-ai/archive/refs/heads/main.tar.gz`, ≈ 2 MB).
2. Extract anywhere, e.g. `D:\dsh-posterflow-ai-main`. The repo **already contains the built
   `lib/client.js` and `lib/index.js`**, so no Node, no `pnpm install`, no compilation is needed.
3. Install either way:
   - *Settings → Plugins → Add plugin* → choose **local path** and point at that folder;
   - or `dsh plugin --profile <your profile> add "file:D:\dsh-posterflow-ai-main"`.
4. **Fully quit and reopen DSH** (the `dsh.client` scan is cached until restart); the entry appears as the
   last sidebar row.
5. The extracted folder **can be deleted afterwards** — pnpm copied/hard-linked the files into the profile;
   verified by renaming the source folder and reloading.

```sh
# from GitHub (also gets auto-listed by the community marketplace)
dsh plugin --profile web add "github:Something11235/dsh-posterflow-ai#main"

# local development
dsh plugin --profile plugindev add link:/absolute/path/to/dsh-posterflow-ai
```

> **Desktop app note**: the `desktop` profile is owned exclusively by the Electron app and the CLI
> refuses to touch it. Install through *Settings → Plugins → Add plugin* by pasting the repo address,
> then **fully quit and reopen** the app (`dsh.client` scan results are cached until restart).

## Configuration

Override the row by `id` in your profile's `cordis.patch.yml`. `config` is a **whole-row
replacement, not a deep merge** — omitted fields fall back to their schema default.

```yaml
- id: dsh-posterflow-ai
  name: dsh-posterflow-ai
  config:
    targetUrl: https://www.posterflow-ai.xyz/
    buttonLabel: 开启生图模式
    openIn: new-tab        # or same-tab
    transition: video      # or none (navigate immediately)
    videoSource: inline    # or route
    muted: true
    maxWaitMs: 8000
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `targetUrl` | string | `https://www.posterflow-ai.xyz/` | Where to land after the transition |
| `buttonLabel` | string | `开启生图模式` | Button text |
| `openIn` | `new-tab` \| `same-tab` | `new-tab` | New tab (keeps your session UI) or navigate away |
| `transition` | `video` \| `none` | `video` | Play the transition clip |
| `videoSource` | `inline` \| `route` | `inline` | `inline` = the video inlined in the bundle (**always plays**); `route` = the host HTTP route (only when the page is actually served by `ctx.webServer`) |
| `videoFile` | string | `assets/transition.webm` | Package-internal file used in `route` mode |
| `muted` | boolean | `false` | Plays **with sound** by default; if the autoplay policy refuses, it falls back to muted and offers a “enable sound” button in the corner |
| `maxWaitMs` | integer 0–60000 | `8000` | Give up on the clip after this and just navigate |

## How it works (two halves)

A **dual-face plugin**:

| Half | Artefact | Job |
| --- | --- | --- |
| Host (Node) | `lib/index.js` | Registers only a config route that hands deployment config to the browser as JSON (plus an optional video route for `videoSource: route`) |
| Browser | `lib/client.js` | A lazy-CJS table registering **two** things: the last row of the sidebar list (`sidebar.panellist`, order 100) and the matching main panel (`main` keyed `posterflow-ai`), which plays the inlined transition and navigates |

Six deliberate choices:

1. **That sidebar row is not a plain button slot.** Every id in `sidebar.panellist` maps to **a main panel** —
   插件 / 自动化任务 are `plugins` (order 0) and `schedules` (order 10). The sidebar renders the button and reads
   its `label` from the registration metadata; our component only draws the **icon** (owner props are just
   `size` / `active`). So clicking the row switches to the panel with the same id: we also register
   `main` keyed `posterflow-ai` to run “transition → redirect”, and use order 100 to be the last row.
2. **The video is inlined in the bundle (default), with no HTTP route involved.** This is the post-mortem fix:
   the desktop GUI's `127.0.0.1:19387` is **not** the `ctx.webServer` route surface — measured, even the
   kernel's own `/plugins/...` returns 404 — so “host registers a route, the page fetches it” cannot work on
   the desktop app: the clip always fails to load and the redirect fires immediately (exactly the
   “no video plays at all” report).
   The clip is first compressed with ffmpeg to **1080 wide / CRF 48 / 24 fps / 24 kbps mono**
   (2.66 MiB → **458 KB**), then [`scripts/embed-video.mjs`](scripts/embed-video.mjs) turns it into a data URI
   inlined into `lib/client.js` (bundle ≈ **659 KB**). In exchange it **always plays**: no ports, no protocol,
   no CORS, no routes.
3. **The transition fills the entire window.** The overlay is `position: fixed; inset: 0`, the video is
   `width/height: 100%` with `object-fit: cover`, so it is a full-window fill rather than letterboxed.
   It plays **with sound** by default (`muted: false`). If audible autoplay is refused, it retries muted so the
   visuals always play, and shows a bottom-centre **🔊 点击开启声音** control — that click is a user gesture, so
   unmuting always works. The inlined clip's audio is also normalised with ffmpeg `loudnorm` to about **−15 dB**
   (it was −25 dB, quiet enough to be mistaken for silence).
4. **One click runs once, and only one tab opens.** Two rounds of traps; the conclusion:
   - **The DSH desktop Electron main process denies every `window.open` and calls `shell.openExternal(url)`
     instead** (see `app.asar/lib/main.js`). So on the desktop app `window.open` **always returns `null`**,
     while the site **has already been opened once** by the host in the system browser. The old code read
     `null` as “blocked” and also ran `location.assign()` on the current page — one open in the new window,
     one in the current page. `null` is now reported as `blocked` and **never navigates**; the panel points
     the user at the manual link instead.
   - The de-duplication window grew from 1.5 s to **20 s** (`LAUNCH_DEDUPE_MS`): the panel can be remounted
     (React StrictMode / slot re-registration), and 1.5 s cannot cover “remounted after the ~6.5 s clip ends”.
   - The `new-tab` path calls **`window.open` exactly once** (named window, `opener` cleared afterwards).
   Diagnostic counters (`触发 / apply / effect / 渲染 / 被拦`) are still maintained but go **to the console only**,
   never to the UI. Tests: [`tests/launcher.test.ts`](tests/launcher.test.ts),
   [`tests/open-target.test.ts`](tests/open-target.test.ts) (including “returns null ⇒ no navigation”),
   [`tests/panel-ui.test.ts`](tests/panel-ui.test.ts) (the panel has exactly two lines).
5. **The client half cannot read the host's `Config`**, so the host exposes `/posterflow-ai/config.json`
   (`Cache-Control: no-store`). If the fetch fails the client falls back to built-in defaults — and the default
   is the inlined video, so **the entry never stops working because a route is unreachable**.
6. **No `inject: ['webServer']`.** It reads `ctx.get('webServer')` and degrades, so the plugin also loads in
   non-web profiles (it simply registers no routes).

## Development

```sh
pnpm install
pnpm run embed           # regenerate the inlined data-URI module from assets/transition.webm
pnpm run typecheck && pnpm run lint && pnpm run test
pnpm run build
pnpm run test:artifact   # host artefact on a REAL WebServer, with REAL HTTP requests
pnpm run test:client     # browser artefact: lazy-CJS contract (pure Node, no browser needed)
```

### Seven gates

| Gate | Covers |
| --- | --- |
| `verify:embed` | The inlined video module matches `assets/transition.webm` (catches “changed the clip, forgot to regenerate”) |
| `typecheck` | Strict TS, including the client half's lazy-CJS shape |
| `lint` | oxlint (the generated video module is excluded) |
| `test` | **55 cases** across six files: pure logic (Range parsing, path-escape guard), the registration contract (last row + matching main panel), the panel UI (exactly two lines), launch de-duplication (20 s window / in-flight / diagnostics / audio verdict), window opening (exactly once, `null` never navigates), and a **real WebServer with real HTTP requests** |
| `build` | tsdown → `lib/index.js` (ESM) + `lib/client.js` (IIFE plain script, ≈ 659 KB) |
| `test:artifact` | The built host artefact mounted on a real WebServer: routes answer, and vanish on dispose |
| `test:client` | Executes the built `lib/client.js` in Node: **0 module requests and 0 DOM mutations at execution** (the lazy contract), and `name/inject/apply` after materialization |

## Known limitations

- **Web only.** The browser half loads only in the Web shell; in `desktop`/headless only the host half runs.
- **Changing the `dsh.client` declaration needs a restart** (scan results are cached); only artefact bytes
  changes can go live.
- **The clip is inlined at build time** — replace `assets/transition.webm`, run `pnpm run embed`, rebuild
  (`verify:embed` fails CI if you forget).
- **The redirect opens the external browser** (new tab by default). Opening it in DSH's built-in browser needs
  the `sidebarRightTabs` service contract, which that package does not publish types for — **not implemented**.
- The entry sits at the **last row** of the sidebar list (`PANEL_ORDER = 100`). Change that order to move it, or
  switch to a button-style slot such as `sidebar.footer.action` (then only one registration is needed).

## Maintainer: publishing to npm

```powershell
cd 'D:\Projects\DSH工作台\插件制作\dsh-posterflow-ai'
npm login        # first time; the local .npmrc neutralises the dead proxy so the registry is reachable
npm publish      # prepublishOnly runs all seven gates first; nothing is uploaded unless they pass
```

After publishing, anyone — **including machines without git** — installs by typing `dsh-posterflow-ai`
in *Settings → Plugins → Add plugin*: no git, no Node, no build.

Releases: change something → `npm version patch` (or `minor` / `major`) → `git push --follow-tags` → `npm publish`.

## License

MIT
