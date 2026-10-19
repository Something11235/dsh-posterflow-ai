# dsh-posterflow-ai

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：在 Web 界面侧栏加一个「**开启生图模式**」入口，点击后**铺满整个窗口**播放一段过场动画，然后跳转到 [PosterFlow](https://www.posterflow-ai.xyz/)。

[![npm version](https://img.shields.io/npm/v/dsh-posterflow-ai.svg)](https://www.npmjs.com/package/dsh-posterflow-ai)
[![license](https://img.shields.io/npm/l/dsh-posterflow-ai.svg)](./LICENSE)

# PosterFlow AI

## 在线使用

访问 **[PosterFlow AI 在线版](https://www.posterflow-ai.xyz)**，无需下载或安装，打开即可使用。你既可以直接使用注册即送的平台积分，也可以使用自己的API Key配置自己掌控接口。

> 自带 Key 只保存在当前浏览器标签页，不会写入数据库、生成历史或云端图片存储。关闭标签页后需要重新填写，请只使用可信服务商提供的 HTTPS 接口。

PosterFlow AI 是一个 AI 图片工作台，把日常生图、参考图修改、局部重绘和无限画布放在同一个页面里。你可以用它来做海报、产品图、社交媒体配图，也可以把多张参考图放在一起，让模型按你的要求修改。

## 主要功能

左侧模式切换对应三种不同的控制方式：

### 1. AI创作

- 输入描述生成图片，也可以上传参考图进行图生图。
- 最多同时使用 8 张参考图，并在提示词里用 `@图1`、`@图2` 指定素材。
- 支持批量生成、常用画幅和画质设置。
- 生成结果可以下载、放大预览、复制提示词或继续修改。

### 2. 局部重绘

选一张生成结果，写清楚想改的地方，例如“把背景换成夜景，保留人物和构图”，程序会自动把原图带入下一次请求。也可以从画廊里的图片直接发起重绘。

### 3. 无限画布

把生成的图片、电脑里的素材和文字标注放在同一张画布上，适合做方案整理、构图比较和修改说明。

- 支持导入 PNG、JPG、WebP、GIF 和 SVG。
- 支持选择、平移、箭头、矩形、圆形、画笔和文字工具。
- 画布会保存在当前浏览器里，刷新后可以继续编辑。
- 可将当前选区或整张画布导出为 PNG。
- 通过“画布 AI”可以按图框比例生成图片，也可以根据标注进行重绘。

![PosterFlow AI 无限画布与标注重绘示例](docs/screenshots/infinite-canvas-example.png)

*无限画布示例：导入原图后使用红色箭头和文字定位修改区域，在画布 AI 中检查参考图并生成重绘版本。*

## 三分钟上手

1. 打开 [在线版](https://www.posterflow-ai.xyz)。
2. 注册账号，并到邮箱点击确认链接。
3. 在“AI 创作”里输入想生成的画面，或上传参考图。
4. 选择画幅和画质，点击生成。
5. 在右侧画廊中下载结果，或继续重绘、加入无限画布。

### 使用平台积分

切换到“平台免费积分”即可查看余额并使用平台图片服务。每张图片消耗 1 个积分，批量生成会按图片数量扣除；失败或超时会自动退回。

平台图片服务使用 **Image2.5** 模型。平台充值功能目前默认关闭，是否开放以网站实际显示为准。

### 使用自己的 API Key

打开“图片服务”，切换到“自带 API Key”，选择服务商并填写接口地址、模型名和 Key，然后保存配置即可。

Key 只保存在当前浏览器标签页，不会写入数据库、生成历史或云端图片。关闭标签页后需要重新填写。请只使用可信服务商提供的 HTTPS 接口。

#### 如何获取API Key

下面以 OpenRouter 为例。页面布局和可用支付方式可能随地区、账号及平台更新而变化，请以 OpenRouter 实际页面为准；如果使用其他中转站，请查阅对应服务商的 Key 创建说明。

1. 打开 [OpenRouter](https://openrouter.ai/) 并注册或登录账号。如果网站无法访问，请先检查当前网络环境和浏览器设置。
2. 进入账户的 `Credits` 页面，点击 `Add Credits`，按页面提示选择金额和支付方式完成充值。创建 Key 本身不一定要求充值，但调用付费模型前需要有可用余额。

![在 OpenRouter Credits 页面添加余额](docs/api-key-guide/openrouter-credits.png)

部分账号可在支付窗口底部开启 `Use one-time payment methods`，再选择页面提供的一次性支付方式。

![在 OpenRouter 购买窗口选择一次性支付方式](docs/api-key-guide/openrouter-purchase.png)

3. 进入 `API Keys` 页面，点击右上角 `New Key`。建议填写便于识别的名称，例如 `PosterFlow AI`，并根据自己的预算设置额度上限或到期时间。

![在 OpenRouter API Keys 页面创建 New Key](docs/api-key-guide/openrouter-api-keys.png)

4. 创建后立即复制并妥善保存 Key。完整 Key 通常只显示一次，不要把它发送给他人，也不要写进截图、README、Issue、聊天记录或前端代码。
5. 回到 PosterFlow AI，打开“图片服务”，选择 `OpenRouter`，粘贴 Key。OpenRouter 预设会自动填写接口地址和模型；点击“检查配置”，确认无误后再“保存并使用”。

如果 Key 意外泄露，请立即回到 OpenRouter 的 `API Keys` 页面删除或吊销旧 Key，并创建新 Key。建议始终设置合理额度，避免异常调用造成额外费用。

## 隐私与安全

- 自带 API Key 只保存在浏览器会话中，不上传到数据库。
- 用户的生成历史和图片按账号隔离。
- 平台密钥只在服务端使用，不会发送到浏览器。
- 邮箱验证由 Supabase Auth 处理，未验证邮箱不能使用平台积分。
- 不要把 API Key 写进源码、截图、提交记录或公开 Issue。

## 许可

MIT
