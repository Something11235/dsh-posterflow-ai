# dsh-posterflow-ai

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin: a **PosterFlow launcher** in the Web sidebar. Click **开启生图模式**, watch a transition video, land on [PosterFlow](https://www.posterflow-ai.xyz/).

> Chinese version: [README.zh.md](./README.zh.md)

## What it does

```
sidebar footer (next to Settings)
┌──────────────────────────┐
│  🖼 开启生图模式           │  ← click
└──────────────────────────┘
        ↓
  full-screen transition video (assets/transition.webm)
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
> refuses to touch it. Install through the app's own *Settings → Plugins* UI, or edit
> `package.json` + `cordis.patch.yml` under `$DSH_HOME/profiles/desktop/` by hand — then **restart**.
> A restart is required because `dsh.client` scan results (including the negative "not a client
> package" verdict) are cached until restart.

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
    videoFile: assets/transition.webm
    muted: true
    maxWaitMs: 8000
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `targetUrl` | string | `https://www.posterflow-ai.xyz/` | Where to land after the transition |
| `buttonLabel` | string | `开启生图模式` | Button text |
| `openIn` | `new-tab` \| `same-tab` | `new-tab` | New tab (keeps your session UI) or navigate away |
| `transition` | `video` \| `none` | `video` | Play the transition video |
| `videoFile` | string | `assets/transition.webm` | Video path **inside the package** |
| `muted` | boolean | `true` | Muting is the only reliable way to autoplay |
| `maxWaitMs` | integer 0–60000 | `8000` | Give up on the video after this and just navigate |

## How it works (two halves)

A **dual-face plugin**; the halves do different jobs:

| Half | Artefact | Job |
| --- | --- | --- |
| Host (Node) | `lib/index.js` | Registers two HTTP routes: serves the **transition video** on demand (Range/206/416/HEAD), and hands the **deployment config** to the browser as JSON |
| Browser | `lib/client.js` | A lazy-CJS table: registers the button into `sidebar.footer.action`; on click it loads config → plays the video → navigates |

Three deliberate choices:

1. **The video is served, not inlined.** It is 2.66 MiB; base64-inlining it would push the client
   bundle to ~3.6 MB downloaded on every page boot. Through
   `ctx.webServer.register({ kind: 'exact', path: '/posterflow-ai/transition.webm' })` the browser
   fetches it only when it actually plays, and `Range` requests get a proper 206 (video seeking
   depends on it).
2. **The client half cannot read the host's `Config`**, so the host exposes
   `/posterflow-ai/config.json` (`Cache-Control: no-store`). If the fetch fails the client falls back
   to built-in defaults — the button never stops working.
3. **No `inject: ['webServer']`.** It reads `ctx.get('webServer')` and degrades, so the plugin also
   loads in non-web profiles (it simply registers no routes). The browser half only exists in the
   Web shell anyway.

The button registers into `sidebar.footer.action` (list / root scope, `{id, order, label}`) with
`order: 20`, coexisting with `cordis-panel` and dsh-context's `context-overview`. In the 56px rail
the owner passes `wide: false` and only the icon is rendered.

## Development

```sh
pnpm install
pnpm run typecheck && pnpm run lint && pnpm run test
pnpm run build
pnpm run test:artifact   # host artefact on a REAL WebServer, with REAL HTTP requests
pnpm run test:client     # browser artefact: lazy-CJS contract (pure Node, no browser needed)
```

### Six gates

| Gate | Covers |
| --- | --- |
| `typecheck` | Strict TS, including the client half's lazy-CJS shape |
| `lint` | oxlint |
| `test` | **23 cases**: `tests/route.test.ts` pure logic (Range parsing, path-escape guard); `tests/webserver.test.ts` a **real WebServer with real HTTP requests** |
| `build` | tsdown → `lib/index.js` (ESM) + `lib/client.js` (IIFE plain script) |
| `test:artifact` | The built host artefact mounted on a real WebServer: routes answer, and vanish on dispose |
| `test:client` | Executes the built `lib/client.js` in Node: **0 module requests and 0 DOM mutations at execution** (that is the lazy contract), and `name/inject/apply` after materialization |

The most interesting cases in `tests/webserver.test.ts`: a Range request returns 206 whose first four
bytes are the WebM/EBML magic; an out-of-range Range returns 416; `HEAD` returns headers only; and a
`videoFile` that tries to escape the package directory is **refused** rather than read.

## Known limitations

- **Web only.** The browser half loads only in the Web shell; in `desktop`/headless only the host half
  runs (no routes registered).
- **Changing the `dsh.client` declaration needs a restart** (scan results are cached); only artefact
  bytes changes can go live.
- The transition video is a **bundled asset** — you cannot point `videoFile` at an arbitrary HTTP URL,
  and it is confined to the package directory.
- The button lives in the sidebar footer. To move it, change the slot key in `src/client.ts`
  (the reference workspace lists 90 live mount points in `reference/live-slot-catalog.md`).

## License

MIT
