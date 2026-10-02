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

## Install

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
| `muted` | boolean | `true` | Start muted; when `false`, unmute once playback has begun |
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
   It starts muted (the only reliable autoplay guarantee) and unmutes after `playing` when configured to.
4. **One click runs once.** React StrictMode re-runs effects and clicks can be delivered twice; without a gate
   that means **the video plays twice and two tabs open** — the reported “the same screen appears twice”.
   `createLauncher()` de-duplicates with a 1.5 s window plus an in-flight flag, pinned by
   [`tests/launcher.test.ts`](tests/launcher.test.ts).
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
| `test` | **39 cases** across four files: pure logic (Range parsing, path-escape guard), the registration contract (last row + matching main panel), the launch gate (single-fire), and a **real WebServer with real HTTP requests** |
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

## License

MIT
