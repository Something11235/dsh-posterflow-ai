(function() {
	//#region src/client.ts
	window.__ModuleLoader__.load({
		id: "dsh-posterflow-ai",
		factory: (require) => {
			const React = require("react");
			/** 与宿主 Config 的默认值保持一致；路由读不到时用它们兜底。 */
			const DEFAULTS = {
				targetUrl: "https://www.posterflow-ai.xyz/",
				buttonLabel: "开启生图模式",
				openIn: "new-tab",
				transition: "video",
				videoUrl: "/posterflow-ai/transition.webm",
				muted: true,
				maxWaitMs: 8e3
			};
			let cached;
			/** 读宿主配置；任何失败都用默认值兜底，绝不因此让按钮失灵。 */
			const loadConfig = async () => {
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
			};
			/** 跳转；`new-tab` 被浏览器拦下时降级为当前页跳转。 */
			const openTarget = (config) => {
				if (config.openIn === "same-tab") {
					window.location.assign(config.targetUrl);
					return;
				}
				const opened = window.open(config.targetUrl, "_blank", "noopener,noreferrer");
				if (opened === null || opened === void 0) window.location.assign(config.targetUrl);
			};
			/** 播放过场视频；结束、出错、超时、或用户点击画面都会立刻放行。 */
			const playTransition = (config) => new Promise((resolve) => {
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
			});
			/** 侧栏底部的按钮。owner 会传 `wide`（false = 56px 折叠栏）。 */
			const Action = (props) => {
				const wide = props.wide === true;
				const [label, setLabel] = React.useState(DEFAULTS.buttonLabel);
				const [busy, setBusy] = React.useState(false);
				React.useEffect(() => {
					let alive = true;
					loadConfig().then((config) => {
						if (alive) setLabel(config.buttonLabel);
					});
					return () => {
						alive = false;
					};
				}, []);
				const onClick = () => {
					if (busy) return;
					setBusy(true);
					(async () => {
						const config = await loadConfig();
						if (config.transition === "video") await playTransition(config);
						openTarget(config);
					})().finally(() => setBusy(false));
				};
				return React.createElement("button", {
					type: "button",
					onClick,
					disabled: busy,
					title: label,
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: wide ? "flex-start" : "center",
						gap: "6px",
						width: wide ? "100%" : "32px",
						padding: wide ? "6px 10px" : "6px 0",
						border: "1px solid var(--dsw-alias-border-l1)",
						borderRadius: "8px",
						background: "transparent",
						color: busy ? "var(--dsw-alias-label-secondary)" : "var(--dsw-alias-label-primary)",
						cursor: busy ? "progress" : "pointer",
						font: "inherit",
						fontSize: "12px",
						opacity: busy ? "0.6" : "1"
					}
				}, wide ? `🖼 ${label}` : "🖼");
			};
			const apply = (ctx) => {
				ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
					name: "sidebar.footer.action",
					id: "posterflow-ai",
					order: 20,
					label: () => DEFAULTS.buttonLabel
				}, Action));
			};
			return {
				name: "posterflow-ai",
				inject: ["slots"],
				apply
			};
		}
	});
	//#endregion
})();

//# sourceMappingURL=client.js.map