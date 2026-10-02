import fs from "node:fs";
import z from "@deepseek-ai/schemastery";
import { fileURLToPath } from "node:url";
import path from "node:path";
//#region src/route.ts
/**
* 纯逻辑：路由相关的辅助函数与路径安全。
*
* 单独成文件的原因：这些是唯一"值得单测"的部分（Range 解析、内容类型、路径逃逸防护），
* 而且它们不 import 任何 DSH 包，可以脱离宿主跑。
*/
/**
* 解析 HTTP `Range` 头。
*
* 视频播放器（尤其 Chromium）会发 `Range: bytes=0-` 探路，seek 时会发具体区间；
* 不支持 Range 的服务器仍能播，但 seek/续播行为会退化，所以这里实现最小可用子集。
*
* @param header - `Range` 头原文，可能为空。
* @param size - 资源总字节数。
* @returns 需要返回的闭区间；`null` 表示"按整份返回"；`'unsatisfiable'` 表示 416。
*/
function parseRange(header, size) {
	if (header === void 0 || header === "") return null;
	const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
	if (match === null) return null;
	const rawStart = match[1] ?? "";
	const rawEnd = match[2] ?? "";
	if (rawStart === "" && rawEnd === "") return null;
	let start;
	let end;
	if (rawStart === "") {
		const suffix = Number(rawEnd);
		if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(rawStart);
		end = rawEnd === "" ? size - 1 : Number(rawEnd);
	}
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	if (size <= 0) return "unsatisfiable";
	if (start > end || start >= size) return "unsatisfiable";
	return {
		start,
		end: Math.min(end, size - 1)
	};
}
const CONTENT_TYPES = {
	".webm": "video/webm",
	".mp4": "video/mp4",
	".webp": "image/webp",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".gif": "image/gif",
	".json": "application/json; charset=utf-8"
};
/**
* 按扩展名给出 Content-Type；未知类型回落 `application/octet-stream`。
* @param fileName - 文件名或路径。
* @returns MIME 类型。
*/
function contentTypeFor(fileName) {
	return CONTENT_TYPES[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}
/**
* 把包内相对路径解析成绝对路径，并**保证它没有逃出包目录**。
*
* 为什么必须做这件事：`videoFile` 来自 patch 层的配置。如果直接 `path.join(root, videoFile)`，
* 一份写着 `../../../../.credentials.yaml` 的配置就能让插件把宿主的凭据文件当视频发出去。
* 配置是"可信的部署输入"，但一个会读文件的插件不该给配置留这种口子。
*
* @param packageRoot - 包根目录的绝对路径。
* @param relativePath - 包内相对路径。
* @returns 绝对路径。
* @throws 当目标逃出包根目录时。
*/
function resolveInsidePackage(packageRoot, relativePath) {
	const root = path.resolve(packageRoot);
	const target = path.resolve(root, relativePath);
	const relative = path.relative(root, target);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`videoFile escapes the package directory: ${relativePath}`);
	return target;
}
/**
* 组装给 client 半边的配置载荷。
* @param config - 宿主侧已校验的配置。
* @param videoUrl - 宿主实际注册的视频路由地址。
* @returns 可 JSON 序列化的载荷。
*/
function buildClientConfig(config, videoUrl) {
	return {
		targetUrl: config.targetUrl,
		videoSource: config.videoSource,
		buttonLabel: config.buttonLabel,
		openIn: config.openIn,
		transition: config.transition,
		videoUrl,
		muted: config.muted,
		maxWaitMs: config.maxWaitMs
	};
}
//#endregion
//#region src/index.ts
/**
* dsh-posterflow-ai —— 网站跳转插件（宿主半边）。
*
* 流程：用户在 Web 界面点「开启生图模式」→ 播放过场视频 → 跳转到 PosterFlow。
*
* 宿主半边只做两件事：
*   ① 把过场视频按 HTTP 路由提供给浏览器（视频 2.66 MiB，内联进 client bundle 会变成
*      3.6 MB 的 JS，所以走路由按需传输）；
*   ② 把部署期配置以 JSON 路由暴露给 client 半边（client 半边读不到宿主的 Config）。
*
* 设计取舍：**不 inject `webServer`**。这个插件是给 Web 界面用的，但用 `ctx.get('webServer')`
* 读取并降级，可以让它在 headless 之类的 profile 里也能正常加载（只是不提供路由），
* 而不是因为依赖缺失一直等在那里。
*/
/** 诊断信息里的插件名。 */
const name = "posterflow-ai";
/** 没有必需服务：`webServer` 是可选能力，用 `ctx.get` 读取。 */
const inject = [];
/** 路由前缀，与 client 半边里的地址保持一致。 */
const ROUTE_PREFIX = "/posterflow-ai";
/** 过场视频的路由。 */
const VIDEO_ROUTE = `${ROUTE_PREFIX}/transition.webm`;
/** 运行时配置的路由。 */
const CONFIG_ROUTE = `${ROUTE_PREFIX}/config.json`;
/** 侧栏主列表那一行的 id，同时也是 `main` 面板的 key。 */
const PANEL_ID = "posterflow-ai";
/** 侧栏主列表（「插件」「自动化任务」所在的那一列）。 */
const SLOT_PANEL_LIST = "sidebar.panellist";
/** 主面板 keyed 槽，承载过场与跳转。 */
const SLOT_MAIN = "main";
/** 排在最后一行：既有的 plugins = 0、schedules = 10。 */
const PANEL_ORDER = 100;
/** Config 的运行时校验 schema。 */
const Config = z.object({
	targetUrl: z.string().default("https://www.posterflow-ai.xyz/"),
	videoSource: z.union([z.const("inline"), z.const("route")]).default("inline"),
	buttonLabel: z.string().default("开启生图模式"),
	openIn: z.union([z.const("new-tab"), z.const("same-tab")]).default("new-tab"),
	transition: z.union([z.const("video"), z.const("none")]).default("video"),
	videoFile: z.string().default("assets/transition.webm"),
	muted: z.boolean().default(true),
	maxWaitMs: z.number().step(1).min(0).max(6e4).default(8e3)
});
/**
* 把视频按 Range 语义发给浏览器。响应由本函数完全接管。
* @param req - 入站请求（读 `Range` 头与 method）。
* @param res - 响应对象。
* @param filePath - 视频文件的绝对路径。
*/
function serveVideo(req, res, filePath) {
	let size;
	try {
		size = fs.statSync(filePath).size;
	} catch {
		res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		res.end(`transition video not found: ${filePath}`);
		return;
	}
	const type = contentTypeFor(filePath);
	const range = parseRange(req.headers.range, size);
	if (range === "unsatisfiable") {
		res.writeHead(416, {
			"Content-Range": `bytes */${size}`,
			"Accept-Ranges": "bytes"
		});
		res.end();
		return;
	}
	const headers = {
		"Content-Type": type,
		"Accept-Ranges": "bytes",
		"Cache-Control": "public, max-age=3600"
	};
	if (range) {
		headers["Content-Length"] = range.end - range.start + 1;
		headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
		res.writeHead(206, headers);
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		const stream = fs.createReadStream(filePath, {
			start: range.start,
			end: range.end
		});
		stream.on("error", () => res.destroy());
		stream.pipe(res);
		return;
	}
	headers["Content-Length"] = size;
	res.writeHead(200, headers);
	if (req.method === "HEAD") {
		res.end();
		return;
	}
	const stream = fs.createReadStream(filePath);
	stream.on("error", () => res.destroy());
	stream.pipe(res);
}
/**
* 插件主体。
* @param ctx - 插件上下文。
* @param config - 已按 {@link Config} 校验过的配置。
*/
function apply(ctx, config) {
	const packageRoot = fileURLToPath(new URL("..", import.meta.url));
	let videoPath;
	if (config.transition === "video") try {
		videoPath = resolveInsidePackage(packageRoot, config.videoFile);
	} catch (error) {
		ctx.logger.warn(`[${name}] ${error.message}；过场视频已禁用`);
	}
	const webServer = ctx.get("webServer");
	if (webServer === void 0) {
		ctx.logger.info(`[${name}] 当前 profile 没有 webServer，界面入口不可用（浏览器半边只存在于 Web 界面）`);
		return;
	}
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: CONFIG_ROUTE,
		handler: (_req, res) => {
			const body = JSON.stringify(buildClientConfig(config, VIDEO_ROUTE));
			res.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Content-Length": Buffer.byteLength(body),
				"Cache-Control": "no-store"
			});
			res.end(body);
		}
	}));
	if (videoPath !== void 0) ctx.effect(() => webServer.register({
		kind: "exact",
		path: VIDEO_ROUTE,
		handler: (req, res) => serveVideo(req, res, videoPath)
	}));
	ctx.logger.info(`[${name}] 已就绪：按钮「${config.buttonLabel}」→ ${config.openIn === "new-tab" ? "新标签页打开" : "当前页跳转"} ${config.targetUrl}` + (videoPath === void 0 ? "（无过场视频）" : `（过场视频 ${VIDEO_ROUTE}）`));
}
//#endregion
export { CONFIG_ROUTE, Config, PANEL_ID, PANEL_ORDER, ROUTE_PREFIX, SLOT_MAIN, SLOT_PANEL_LIST, VIDEO_ROUTE, apply, inject, name };

//# sourceMappingURL=index.js.map