# 源码说明

## Moments V1

朋友圈能力位于 `moments_library/` 与 `moments_publisher/`，详细说明和明日测试步骤见 [`docs/MOMENTS-LIBRARY-V1.md`](../docs/MOMENTS-LIBRARY-V1.md)。

工作台的 `朋友圈` 一级页面位于 `public/index.html`、`public/moments-publisher-panel.js` 和 `server.js`：读取 `D:\朋友圈weflow\ready`，支持封面/标签/日期筛选与九宫格预览。点击“发送到微信待发布”调用完整发布技能：检查/启动微信、等待人工登录、打开朋友圈、加图、填文案，最后停在发表前，不会自动点发表。

```powershell
python -m moments_library.collect --friend "老微信备注名" --output "D:\朋友圈作品库" --limit 10
python -m moments_publisher --library "D:\朋友圈作品库" prepare-today --dry-run
python -m moments_publisher --library "D:\朋友圈作品库" prepare-today --live
python -m moments_publisher --library "D:\朋友圈作品库" mark-published
```

`prepare-today` 默认是 dry-run；只有显式 `--live` 才会操作微信。V1 永远不会自动点击最终“发表”按钮。微信未启动时 live 会尝试按注册路径启动；登录窗口只做一次控件级“进入微信”点击并等待人工完成登录，超时保留同一作品为 `QUEUED`。当前微信 4.1.x 只允许版本门控的渲染画布路径；旧 pyweixin UIA 发布回退已禁用，不会触发其隐含的 Windows 讲述人前置。`--resume-only` 对 WeFlow 会通过本地 HTTP API 重新取得中断条目的临时媒体 URL/key，并保留已有 `.enc`，不会打开微信；pyweixin 则只导入已经落盘的暂存条目。

这里是团建内容工作台的唯一软件源码。

## 模板仓库定位

模板仓库不是某个项目的图片文件夹，而是跨项目、跨平台复用的结构资产层：模板目录保存图片和文案，目录内的 `template.json` 保存来源、标签、模板描述、项目/平台范围及在线镜像信息，仓库级 `02-模板库/模板仓库配置.json` 保存可扩展的项目、平台、分类和自动维护规则。

当前默认范围是“江湖有旅人 · 小红书 · 团建”。后续增加旅行、职场、抖音、公众号或其他项目时，先扩展 `模板仓库配置.json`，不要在 HTML 里硬编码新入口。模板仓库页面会读取配置生成顶部分类入口，并保留旧的 `模板台账.html` 兼容入口。

## AI 维护最短路径

模板维护上下文中，直接把公开笔记链接、模板图片、本地文件夹或在线分享链接交给 AI 即可。AI 按“识别 → 采集/复制 → 分析结构与视觉 → 自动打标签和描述 → 写入 `template.json` → 同步仓库”的流程处理，不要求手动填写 CSV 或先打开 GPT 网页。手工录入开关默认关闭；无法确认的账号、链接或标签会留空并在仓库中显示缺口。

同步命令：

```powershell
npm run sync:template-registry
# 同义的仓库维护入口（由 AI Skill 调用）
npm run maintain:template-repository
```

它会更新 `templates-registry.json`、每个模板目录的 `template.json`、`模板记录.md`、`模板仓库.html` 和旧入口 `模板台账.html`。

## 数据边界

- 模板目录和 `template.json`：模板资产与元信息真源。
- `templates-registry.json`：可检索的本地索引和在线镜像状态。
- `模板仓库配置.json`：仓库范围、平台、分类和 AI 维护策略。
- `链接模板.txt`：在线模板链接输入，不是模板名称或标签的唯一真源。
- HTML、Markdown 记录和更新记录：同步生成的视图，不直接手工维护。

- 不把登录态、Cookie、Token 或完整聊天正文写进模板目录和仓库配置。
- 不静默覆盖同名但内容不同的模板；多候选匹配必须标记待确认。

- `server.js`：本地 HTTP、数据聚合、路径安全和分发 Skill 白名单调用。
- `public/`：浏览器界面。
- `public/distribution-ui.js`：作品集筛选、平台状态文案和设备扫描结果解析。
- `lib/juguang-data.js`：聚光数据读取。
- `lib/distribution-data.js`：作品集、平台入口和分发日志状态读取。
- `mcp/`：聚光数据 MCP 入口。
- `launch.ps1`：无中文编码依赖的正式启动器。

业务素材和成品不在本目录，详见项目根目录 `README.md`。
