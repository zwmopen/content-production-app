# 多平台发布适配器

## 当前边界

工作台只负责统一作品包、标题正文、素材路径、人工确认和任务状态。外部 GitHub 项目负责具体平台执行：

- 小红书：预留 `xiaohongshu-mcp`，仓库为 <https://github.com/xpzouying/xiaohongshu-mcp>。
- 抖音、X / 推特：默认接入官方网页人工接力，不需要 AiToEarn API Key；AiToEarn 仅保留为可选高级适配器，仓库为 <https://github.com/yikart/AiToEarn>。
- 公众号：继续使用工作台现有公众号草稿链路。
- 携程旅行：接入官方内容中心 <https://we.ctrip.com/> 的人工接力链路；工作台准备内容并打开页面，用户在自己的登录态内完成最后发布。

未配置适配器时，接口只允许准备发布包，不会假装登录、上传或发布成功。

## 0.18.73 统一素材到发布工作区

在线平台页现在固定为左侧“现有成品库”与右侧“平台发布区”：左侧直接复用公众号草稿接口返回的作品集、帖子、图片和正文，不复制或另建一套素材状态；进入页面会自动选中第一组作品和第一篇帖子，之后可搜索、按泛流量/精准流量/未分类筛选并切换作品。

公众号右侧继续使用原生网页草稿检查台。小红书继续使用 MCP 适配器；抖音、X / 推特、携程都使用官方网页人工接力，直接准备发布包、复制内容并打开官方页面，不把 API Key 作为使用前提。

## 抖音与 X 的默认免 API Key 网络接力

抖音默认打开 <https://creator.douyin.com/>，X / 推特默认打开 <https://x.com/compose/post>。工作台只负责从左侧现有成品库带入标题、正文和图片路径，点击“准备发布包”只做本地校验；点击“打开官方页面”后，平台登录、图片上传、预览、验证码和最终发布确认都在官方网页内由你完成。

这条路径不读取或保存平台密码、Cookie，不绕过验证码，不承诺规避平台检测，也不会在后台偷偷提交。AiToEarn 的 REST / MCP 代码仍保留给以后确实需要 API 自动化的场景，但现在不参与抖音和 X 的默认页面流程。

## 携程原生内容中心接力

携程内容中心不是 AiToEarn 的渠道，也不是本工作台可以直接验证的公开内容发布 API。在线平台页会从当前作品加载标题、完整正文和图片路径，点击“准备携程发布包”后可以复制内容并打开 `https://we.ctrip.com/`。你在官方页面中手动选择图片、粘贴正文、预览并确认发布；工作台不读取或保存携程密码、Cookie，不绕过验证码，也不在后台偷偷提交。

携程官方规则要求使用本人携程账号，并禁止未经授权的插件、外挂或第三方工具干扰平台正常运行。若账号没有内容中心权限，入口仍会由携程页面按账号资格决定，不在工作台伪造“已发布”。

## 运行数据配置（小红书必需；AiToEarn 仅高级可选）

在 `TEAMBUILDING_DASHBOARD_RUNTIME` 指向的运行数据目录创建 `platform-publishing.json`。小红书官方 MCP 默认端点是 `http://127.0.0.1:18060/mcp`，工作台按标准 MCP Streamable HTTP 握手，不再把它当成普通 JSON 发布接口。下面的抖音/X 配置只用于主动启用 AiToEarn 自动化，不是当前默认路径：

```json
{
  "adapters": {
    "xiaohongshu": {
      "engine": "xiaohongshu-mcp",
      "mode": "mcp-http",
      "endpoint": "http://127.0.0.1:18060/mcp",
      "tool": "publish_content",
      "timeoutMs": 30000,
      "headers": {
        "Authorization": "Bearer put-secret-here"
      }
    },
    "douyin": {
      "engine": "aitoearn",
      "mode": "aitoearn-rest",
      "endpoint": "https://aitoearn.cn",
      "allowRemote": true,
      "platformKey": "douyin",
      "accountId": "从 AiToEarn 已授权账号中填写",
      "headers": {
        "X-Api-Key": "put-secret-here"
      }
    },
    "x": {
      "engine": "aitoearn",
      "mode": "aitoearn-rest",
      "endpoint": "https://aitoearn.cn",
      "allowRemote": true,
      "platformKey": "twitter",
      "accountId": "从 AiToEarn 已授权账号中填写",
      "headers": {
        "X-Api-Key": "put-secret-here"
      }
    }
  }
}
```

上面的 AiToEarn REST 模式走官方开放平台的“素材上传 → 创建发布 Flow → 查询 Flow/任务”链路；`endpoint` 填服务根地址，不要再填 `/api/unified/mcp`。真实密钥不能写进源码、截图、日志或 Git。账号可以直接填 `accountId`，也可以按平台填 `accountIds`；没有填写时工作台会尝试读取已授权账号并匹配平台。检查按钮只读取平台元数据，不会发布。

如果你已经运行 AiToEarn MCP，也可以把抖音或 X 的模式改为 `mcp-http`，远端端点必须配置 `allowRemote: true`，并把 `x-api-key` 放在运行数据的 `headers` 中；工具名和参数以当前服务的 `tools/list` 返回为准，工作台不会猜测工具名。若暂时使用自建的普通 HTTP JSON 桥接，再把模式设为 `http-json`，其请求体和成功响应见下节。

未配置 AiToEarn 时，抖音和 X / 推特仍显示“可手动发布”，可以直接准备发布包、复制内容和打开官方页面。只有你主动把平台切换到 AiToEarn 高级适配器时，才需要在运行数据中补齐 API Key、账号和实际检查配置；这不是默认路径，也不影响当前网页接力。

AiToEarn REST 发布会先为本地图片/视频申请上传地址，再直传素材并确认，最后创建发布 Flow。任务状态会持续轮询；抖音如果返回“等待用户操作”，工作台会停在“等待平台操作”，提示完成手机端确认，不会把中间态误报为成功，也不会自动重复提交。

状态判断采用保守规则：官方明确的等待状态继续轮询，失败/取消状态进入失败；只有返回 `platformWorkId` 或 `workLink` 等完成证据时才记为成功，未知状态不会直接报成功。视频发布会把视频放入 `media`，若表单同时提供图片则取第一张作为 `cover`。

平台面板未配置时会显示配置文件位置，并提供“复制配置模板”按钮；模板不包含真实密钥，复制后仍需人工填入 API Key、授权账号和端点。

AiToEarn 接口检查成功后，工作台会展示服务当前返回的平台元数据；这用于确认账号和服务能力，不等于所有平台都已经经过本工作台验收。当前只对抖音和 X / 推特提供完整发布入口，其他返回平台保留为能力信息，避免把未验证接口伪装成可发布功能。

端点默认只能是本机 HTTP/HTTPS。远端只有在配置 `allowRemote: true` 且使用 HTTPS 时才允许。配置文件属于运行数据，不要提交 Git。

小红书 MCP 常用工具：

- `publish_content`：图文发布，参数为 `title`、`content`、`images`。
- `publish_with_video`：视频发布，参数为 `title`、`content`、`video`。
- `check_login_status`：登录状态探测。
- `tools/list`：工作台里的“发现 MCP 工具”按钮调用，用于核对当前服务实际暴露的工具。

## 适配器协议

工作台向端点 POST JSON：

```json
{
  "platform": "xiaohongshu",
  "title": "标题",
  "body": "正文",
  "images": ["D:\\content\\01.png"],
  "video": null,
  "source": { "collection": "作品集", "workId": "work-123" }
}
```

成功响应建议返回：

```json
{ "ok": true, "remoteId": "platform-id", "url": "https://example.invalid/post/1" }
```

接口：

- `GET /api/platform-publishing/platforms`：读取平台和适配器状态。
- `POST /api/platform-publishing/prepare`：校验发布包，不执行外部动作。
- `POST /api/platform-publishing/publish`：必须带 `confirmed: true`，创建任务并调用适配器。
- `POST /api/platform-publishing/check`：通过 MCP 的 `check_login_status` 或 AiToEarn 的平台与授权账号接口探测当前接入状态，不代替用户登录。
- `POST /api/platform-publishing/tools`：通过 MCP `tools/list` 读取当前服务的工具目录。
- `GET /api/platform-publishing/tasks` 或 `/tasks/:id`：查询任务结果。

配置好的平台面板会提供“准备发布 → 发布前核对 → 明确确认 → 任务轮询”流程；从作品库选择的当前成品会先通过 `/api/platform-publishing/source` 读取成品目录中的完整文案和图片路径，再带入表单，但用户必须在界面中检查内容。读取失败时保留手动填写入口；未配置平台不会显示发布操作。

任务摘要会脱敏保存到运行数据目录的 `platform-publishing-tasks.json`，最多保留最近 30 条；写入前保留 `.bak`。应用重启时，之前处于 `running` 的任务会变成 `interrupted`，不会自动再次调用外部平台，必须先人工确认平台侧是否已经产生内容。

当前发布会话遇到失败或重启中断时，界面提供“重新准备发布”入口，但不会自动重发；重新提交前应先在平台侧核对是否已经生成作品，避免重复内容。

真实平台发布仍需逐个平台做账号、风控、素材和结果验收；“已配置”不等于“已验证”。工作台不会承诺规避平台检测，也不会在没有用户明确确认时代替用户发布。
