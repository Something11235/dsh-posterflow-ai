import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
/** 诊断信息里的插件名。 */
export declare const name = "posterflow-ai";
/** 没有必需服务：`webServer` 是可选能力，用 `ctx.get` 读取。 */
export declare const inject: string[];
/** 路由前缀，与 client 半边里的地址保持一致。 */
export declare const ROUTE_PREFIX = "/posterflow-ai";
/** 过场视频的路由。 */
export declare const VIDEO_ROUTE = "/posterflow-ai/transition.webm";
/** 运行时配置的路由。 */
export declare const CONFIG_ROUTE = "/posterflow-ai/config.json";
/** 侧栏主列表那一行的 id，同时也是 `main` 面板的 key。 */
export declare const PANEL_ID = "posterflow-ai";
/** 侧栏主列表（「插件」「自动化任务」所在的那一列）。 */
export declare const SLOT_PANEL_LIST = "sidebar.panellist";
/** 主面板 keyed 槽，承载过场与跳转。 */
export declare const SLOT_MAIN = "main";
/** 排在最后一行：既有的 plugins = 0、schedules = 10。 */
export declare const PANEL_ORDER = 100;
/** 部署期配置。 */
export interface Config {
  /** 过场结束后跳转的地址。 */
  targetUrl: string;
  /**
   * 视频来源。
   * `inline`（默认）= 用产物里内联的视频，不依赖端口/路由，**一定能播**；
   * `route` = 用宿主注册的 HTTP 路由（只有在页面确实由 `ctx.webServer` 提供服务时才有效）。
   */
  videoSource: 'inline' | 'route';
  /** 按钮文案。 */
  buttonLabel: string;
  /** 跳转方式：新标签页（默认，不会丢掉当前会话界面）或当前标签页。 */
  openIn: 'new-tab' | 'same-tab';
  /** 是否播放过场视频；设为 `none` 则点击后直接跳转。 */
  transition: 'video' | 'none';
  /** 过场视频在包内的相对路径。 */
  videoFile: string;
  /** 视频是否静音（静音是自动播放的唯一可靠保证）。 */
  muted: boolean;
  /** 视频最长等待时间（毫秒），超时直接跳转，避免用户被卡在过场里。 */
  maxWaitMs: number;
}
/** Config 的运行时校验 schema。 */
export declare const Config: z<Config>;
/**
 * 插件主体。
 * @param ctx - 插件上下文。
 * @param config - 已按 {@link Config} 校验过的配置。
 */
export declare function apply(ctx: Context, config: Config): void;
//#endregion
//# sourceMappingURL=index.d.ts.map