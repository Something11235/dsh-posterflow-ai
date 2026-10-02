(function() {
	//#region src/panels.ts
	/** 与宿主 Config 默认值保持一致：路由读不到时用它们兜底。 */
	const DEFAULTS = {
		targetUrl: "https://www.posterflow-ai.xyz/",
		buttonLabel: "开启生图模式",
		openIn: "new-tab",
		transition: "video",
		videoUrl: "/posterflow-ai/transition.webm",
		muted: true,
		maxWaitMs: 8e3
	};
	/** 侧栏主列表那一行的 id，同时也是 `main` 面板的 key。 */
	const PANEL_ID = "posterflow-ai";
	/** 侧栏主列表（「插件」「自动化任务」所在的那一列）。 */
	const SLOT_PANEL_LIST = "sidebar.panellist";
	/** 主面板 keyed 槽，承载过场与跳转。 */
	const SLOT_MAIN = "main";
	/**
	* 组装 client 插件。
	* @param React - 注入的 React。
	* @param runtime - 可选：覆盖副作用实现（单测用）。
	* @returns client 插件对象。
	*/
	function createPanelPlugin(React, runtime = {}) {
		let cached;
		/** 读宿主配置；任何失败都用默认值兜底，绝不因此让入口失灵。 */
		const loadConfig = runtime.loadConfig ?? (async () => {
			if (cached !== void 0) return cached;
			try {
				const response = await fetch("/posterflow-ai/config.json", { cache: "no-store" });
				if (!response.ok) throw new Error(`config route returned ${response.status}`);
				const payload = await response.json();
				cached = {
					...DEFAULTS,
					...payload
				};
			} catch {
				cached = DEFAULTS;
			}
			return cached;
		});
		/** 跳转；`new-tab` 被浏览器拦下时降级为当前页跳转。 */
		const openTarget = runtime.openTarget ?? ((config) => {
			if (config.openIn === "same-tab") {
				window.location.assign(config.targetUrl);
				return;
			}
			const opened = window.open(config.targetUrl, "_blank", "noopener,noreferrer");
			if (opened === null || opened === void 0) window.location.assign(config.targetUrl);
		});
		/** 播放过场视频；结束、出错、超时、或用户点击画面都会立刻放行。 */
		const playTransition = runtime.playTransition ?? ((config) => new Promise((resolve) => {
			let settled = false;
			let timer;
			const overlay = document.createElement("div");
			const video = document.createElement("video");
			const finish = () => {
				if (settled) return;
				settled = true;
				if (timer !== void 0) clearTimeout(timer);
				try {
					video.remove();
				} catch {}
				try {
					overlay.remove();
				} catch {}
				resolve();
			};
			video.muted = config.muted;
			video.autoplay = true;
			video.playsInline = true;
			video.src = config.videoUrl;
			Object.assign(video.style, {
				maxWidth: "100%",
				maxHeight: "100%"
			});
			video.addEventListener("ended", finish);
			video.addEventListener("error", finish);
			overlay.setAttribute("role", "presentation");
			overlay.setAttribute("aria-hidden", "true");
			Object.assign(overlay.style, {
				position: "fixed",
				inset: "0",
				zIndex: "2147483000",
				background: "#000",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				cursor: "pointer"
			});
			overlay.addEventListener("click", finish);
			overlay.appendChild(video);
			document.body.appendChild(overlay);
			timer = setTimeout(finish, config.maxWaitMs);
			const played = video.play();
			if (played !== void 0 && typeof played.catch === "function") played.catch(finish);
		}));
		/**
		* 侧栏那一行只接收**图标**的 owner props（`size` 与 `active`）：
		* 按钮与文案由侧栏自己渲染，文案取自注册时的 `label` 元数据。
		*/
		const Icon = (props) => {
			const size = typeof props.size === "number" && props.size > 0 ? props.size : 16;
			return React.createElement("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.8,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				focusable: "false",
				style: {
					display: "block",
					color: props.active === true ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)"
				}
			}, React.createElement("rect", {
				key: "frame",
				x: 3,
				y: 4.5,
				width: 18,
				height: 15,
				rx: 3
			}), React.createElement("circle", {
				key: "sun",
				cx: 8.5,
				cy: 9.5,
				r: 1.4
			}), React.createElement("path", {
				key: "hill",
				d: "M4.5 17.5l4.5-4.5 3.5 3.5 2.5-2.5 4 4"
			}));
		};
		/**
		* 主面板：挂载即跑「过场 → 跳转」。
		* 必须去重——React 严格模式下 effect 会跑两次，不去重会播两遍视频、开两个标签页。
		*/
		const Panel = () => {
			const [phase, setPhase] = React.useState("running");
			const [message, setMessage] = React.useState("正在开启生图模式…");
			const [targetUrl, setTargetUrl] = React.useState(DEFAULTS.targetUrl);
			const started = React.useRef(false);
			React.useEffect(() => {
				if (started.current) return;
				started.current = true;
				(async () => {
					const config = await loadConfig();
					setTargetUrl(config.targetUrl);
					if (config.transition === "video") {
						setMessage("过场播放中…（点击画面可跳过）");
						await playTransition(config);
					}
					openTarget(config);
					setPhase("done");
					setMessage(`已打开 ${config.targetUrl}`);
				})();
			}, []);
			const link = React.createElement("a", {
				key: "manual",
				href: targetUrl,
				target: "_blank",
				rel: "noopener noreferrer",
				style: {
					color: "var(--dsw-alias-brand-primary)",
					textDecoration: "underline"
				}
			}, "手动打开 PosterFlow");
			return React.createElement("div", { style: {
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: "10px",
				height: "100%",
				minHeight: "240px",
				color: "var(--dsw-alias-label-secondary)",
				fontSize: "13px"
			} }, React.createElement("div", {
				key: "title",
				style: {
					fontSize: "15px",
					color: "var(--dsw-alias-label-primary)"
				}
			}, phase === "running" ? "🖼 开启生图模式" : "🖼 已开启"), React.createElement("div", { key: "message" }, message), link);
		};
		const apply = (ctx) => {
			ctx.slots.inject(SLOT_PANEL_LIST, () => ctx.slots.register({
				name: SLOT_PANEL_LIST,
				id: PANEL_ID,
				order: 100,
				label: () => DEFAULTS.buttonLabel
			}, Icon));
			ctx.slots.inject(SLOT_MAIN, () => ctx.slots.register({
				name: SLOT_MAIN,
				key: PANEL_ID
			}, Panel));
		};
		return {
			name: "posterflow-ai",
			inject: ["slots"],
			apply
		};
	}
	//#endregion
	//#region src/client.ts
	/**
	* client 半边入口 —— 惰性 CJS 表。
	*
	* 这个文件刻意保持极薄：它只做三件事——
	*   ① 声明 `window.__ModuleLoader__`；
	*   ② 注册工厂（此时**不**执行任何模块体副作用）；
	*   ③ 在 factory 里从注入的 `require` 取 `react`，把实现交给 `./panels.js`。
	*
	* 实现放在 `panels.js` 里是为了可测试：脚本形态的文件没法被单测导入。
	* 相对导入会在构建时被 inline 进 `lib/client.js`，因此产物仍然**零 npm 依赖**，
	* 是外壳可以直接 `<script>` 加载的普通脚本（由 scripts/verify-client-bundle.mjs 把关）。
	*/
	window.__ModuleLoader__.load({
		id: "dsh-posterflow-ai",
		factory: (require) => {
			const plugin = createPanelPlugin(require("react"));
			return {
				name: plugin.name,
				inject: plugin.inject,
				apply: plugin.apply
			};
		}
	});
	//#endregion
})();

//# sourceMappingURL=client.js.map