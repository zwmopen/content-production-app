# 团建朋友圈作品库 + 每日半自动发布 V1

## 0.19.58 登录态前置升级（2026-08-20）

- 真实问题：微信已经保存“江湖有旅人团建”登录态，但发布流程仍停在登录窗口；原因是 Qt 登录画面虽然暴露了“进入微信”按钮，窗口未聚焦时一次 UIA `click_input` 不一定真正触发进入。
- 修复：`wechat_preflight.py` 现在按固定判断链执行：已登录主窗口/渲染画布 → 直接进入朋友圈；登录窗口有“进入微信/進入微信/Enter Weixin”按钮 → 置前窗口、聚焦控件、只点击一次并继续观察；登录窗口没有按钮 → 保持 `WAITING_FOR_HUMAN_LOGIN`，等待用户扫码/确认；微信未运行 → 按配置启动后重新判断。
- 自动回归：新增保存登录态单击顺序、单击次数和无按钮人工等待边界测试。
- 真实桌面验收：2026-08-20 已确认保存登录态窗口可进入微信主界面，随后同一 `work_id=2026-08-10_001_江湖有旅人团建` 成功准备 9 张图片和 `content.txt` 原文，状态为 `PREPARED_FOR_HUMAN_CONFIRM`，`final_publish_button_clicked=false`。
- 安全边界：不输入账号密码、不扫码、不点击“发表”；登录未完成只能继续同一作品，不换下一条、不重复采集。

## 2026-08-19 定时任务诊断与登录前置修复

- 今日 10:20 定时任务实际已触发，选中 `2025-08-20_001_江湖有旅人团建`，但失败原因是微信仍停留在“进入微信”登录窗口；日志和截图已保留在作品库 `logs/`，没有点击发表。
- 修复 `wechat_preflight.py` 的判断顺序：登录窗口不再被同名 Qt 外层误判为已登录朋友圈画布；会有限点击一次“进入微信”，等待人工扫码/确认，超时则记录 `WAITING_FOR_HUMAN_LOGIN`。
- 当前没有证据表明 WeFlow 是本次根因：故障现场未发现 WeFlow 进程或 5031 监听；每天发布准备与每月 WeFlow 采集仍保持分离。

## 2026-08-18 技能演进：本地客户端直接准备链路

- 直接调用本地 `http://127.0.0.1:4327/api/moments/prepare` 已实测通过，使用同一 `work_id` 复用现有作品库，不重复采集；状态进入 `PREPARED_FOR_HUMAN_CONFIRM`，`final_publish_button_clicked=false`。
- 当前微信 4.1.12.55 会同时暴露同名原生文件框；发布器现在按 HWND 枚举并选择带真实文件名 `Edit` 控件的窗口，避免 pywinauto 的同名窗口歧义超时；微信客户端窗口过窄时先做一次正常恢复/最大化。
- 九宫格门禁改为按真实图片行分段，不再假设每一行高度相同。当前真实作品源目录有 7 张图，客户端实测 7/7 张完整显示；“最多 9 张”不是每条必须 9 张。
- 当前 Qt 画布不响应 `Ctrl+C`，不能把预置剪贴板内容伪装成文案回读。代码现在优先尝试控件回读；若明确返回哨兵值，则比较粘贴前后的编辑区视觉变化确认编辑器确实发生变化，不能仅凭天然存在的图片网格判定成功，否则立即失败。另修正文案输入带位置：`Y=0.12`，不再点击到输入带上方。当前同一草稿实测 853 字原文已实际显示，发表按钮存在但未点击。
- 本次没有点击最终“发表”，没有执行 `mark-published`，没有移动或删除素材。后续仍由用户检查后手动发表，再确认归档。
- 工作台发送入口改为直接触发：点击“发送到微信待发布”不再弹中间确认框，准备完成后不弹阻塞式成功提示，面板状态与微信窗口作为反馈；最终“发表”仍由用户手动点击。

## 0.18.78 设置与每日定时准备

设置中心中的“朋友圈采集整理与发布设置”现在包含：

- **素材库路径**：后台保存并校验真实目录，默认 `D:\朋友圈weflow`。
- **运行模式**：手动触发或每天按多个时间点自动准备；默认手动，必须显式切换到定时。
- **自动选材规则**：默认使用“智能回退”：先找去年的今天，没有时从去年本月稳定随机，再没有时从历史同月稳定随机，历史素材耗尽后使用今年尚未发布的作品；也可以手动切换为严格去年今日、去年本月、今年素材或随机挑选。今年和历史日期的判断统一按上海日期。

定时模式由工作台后台每 15 秒检查一次 Asia/Shanghai 时间。命中时间后，它调用和面板按钮相同的 `moments_publisher` 准备流程，只从 `ready/` 读取一条作品：打开/定位微信、添加图片、填入 `content.txt`，最后停在“发表”前。每日自动准备条数由技能中心专属设置控制，默认 1，可改为 2 或更高；手动点击不消耗自动额度。它不会自动点击发表，不会自动采集、不补发错过的时间、不连续覆盖等待人工确认的微信窗口。

### 对外说明用的箭头式流程

```text
工作台按钮 / 每日 10:00–12:00 窗口定时
        ↓
读取配置与 D:\朋友圈weflow 作品库
        ↓
选择 1 条素材 → 检查状态、图片、文案
        ↓
检测微信 → 必要时进入登录 → 等待登录完成
        ↓
打开朋友圈 → 加图 → 填入原文案
        ↓
校验图片、文案和“发表”按钮
        ↓
PREPARED_FOR_HUMAN_CONFIRM
        ↓
用户手动点击“发表”
        ↓
mark-published → ready/ → used/
```

月度采集是另一条链路：

```text
每月 1 号 10:20 → WeFlow API 分页读取时间线元数据
                 → 首次锁定上一个完整月份；以后按账号上次成功采集水位继续
                 → 文案/图片/metadata 逐条落盘 → fingerprint 去重
                 → 写入 D:\朋友圈weflow → 等待后续选材
```

之后维护其他技能时，也使用“入口 → 判断 → 执行 → 验证 → 人工边界”的表达方式；每个关键节点都说明自动动作、用户动作和失败停点。

当天状态文件保留最新记录和多次 attempts。`PREPARING`、`PREPARED_FOR_HUMAN_CONFIRM`、`WAITING_FOR_HUMAN_LOGIN` 只表示当前微信窗口有待处理内容，阻止并发覆盖；`CONFIRMED_PUBLISHED` 之后，若自动额度未用完，后续配置时间仍可准备下一条。用户检查并手动发表后，仍需执行 `mark-published` 才归档到 `used/`。

当前工具名称：朋友圈采集整理与发布。内部 Python 模块、CLI 命令和数据目录保持兼容，不因改名创建第二套工具。

状态：V1 采集链路已在本机 WeFlow 上跑通；2026-08-14 已完成目标账号的全量采集：144 条朋友圈、1264 个媒体文件，逐条目录、文案、metadata 和媒体可见性均已核验。随后用目标账号再做 10 条/90 张的原版回归，10/10 条完整落盘、哈希与 JPEG 校验通过，二次导入去重为 0。WeFlow 6.3.0 正式安装最终保持原版；媒体精度补丁只保留在隔离目录，不作为正式依赖。2026-08-15 已用真实作品完成朋友圈发布前实测：9 张图全部进入九宫格，`content.txt` 原文回读一致，最终发表按钮未点击。0.19.198 起，月度任务首次处理上一个完整月份，之后按账号水位补齐上次成功采集以来的完整时间区间；进度写入 `state/collection-progress.json`，手动 10 条测试与月度采集分开。

2026-08-15 运行纠偏：正式库已经有 144 条，面板和发布技能直接复用 `D:\朋友圈weflow\ready`，不因验证流程再次采集。当天实际调用过开源 `pyweixin.Moments.dump_friend_posts`；本机微信 4.1.12.55 的 UIA 树只有 `Qt51514QWindowIcon` 外层和 `MMUIRenderSubWindowHW` 渲染节点，未暴露上游要求的 `mmui::MainWindow` 控件树，因此在好友定位前返回 `NotFoundError`。`pyweixin` 当前只能作为隔离兼容性探针，不能报告为已跑通，也不能让它重复写入正式库。

2026-08-14 维护收口：WeFlow `.partial` 现在可以通过 HTTP API 重新取得临时 URL/key 后续跑；已有 `.enc` 不删除，找不到原动态时立即停并写 traceback。发布器增加文案控件回读、适配器契约和坏媒体门禁；状态 JSON 兼容 Windows UTF-8 BOM。

2026-08-15 面板增量：朋友圈继续留在 `http://127.0.0.1:4327` 主工作台内。面板不再展示顶部“今日推荐”块；左侧显示历史发布日期、来源和地点，右侧显示完整日期、来源、地点、图片数、原文案和最多九张预览图。新增季节、地点、活动类型、使用次数筛选与总作品/总图片统计；右上角设置可以修改素材库根目录、启停模块和自动/手动打开微信。新素材进入规范化 `ready/<work_id>` 后，刷新面板即可识别；“整理并补齐标签”会运行 `catalog annotate`，不会重复采集或修改原始媒体。

2026-08-15 发布失败根因：当前桌面微信会先显示带“进入微信/仅传输文件”的 `mmui::LoginWindow`，它不是朋友圈渲染画布。前一轮现场截图暴露出登录窗口与已登录 Qt 画布都使用 `Qt51514QWindowIcon` 外层类，旧判断可能在登录未完成时直接寻找朋友圈窗口；现有前置已按 `mmui::LoginWindow` 优先进入 `WAITING_FOR_HUMAN_LOGIN`，不会填图或误报成功。文案阶段新增“剪贴板确认 → 重新聚焦 → 粘贴 → 编辑器回读”的有限焦点恢复，防止九宫格重排后只留下光标。

## 产品定位

朋友圈配置采用“软件内置默认模板 + 本机运行覆盖”两层结构。软件包内的
`config/examples/moments-settings.example.json` 可以随项目分享，包含目录、时间和选材规则等脱敏配置；真实账号、UID、Token、作品库、状态和日志仍保存在本机运行配置中，不会被模板覆盖。

这一期先做成主工作台内的本地面板 + 仓库内 Python 软件模块/CLI；同时将已经验证的调用约定、WeFlow 适配器和维护脚本整理为现有私有技能库中的可迁移技能包。技能包不携带微信登录态、Token、UID、作品原文或媒体，只保存可复用流程和脱敏配置示例。设置中心的“启用朋友圈发布器”开关只控制工作台入口和 API，不改变素材库本身。

## 已实现的边界

- `moments_library`：正式采集使用已验证的 WeFlow HTTP API 适配器，保留原始暂存区并规范化成每条独立作品目录；`pyweixin.Moments.dump_friend_posts` 仅保留为显式、隔离的兼容性探针。
- 每条作品保存原始 `content.txt`、自然排序的 `01.jpg/01.png/...`、采集事实 `metadata.json` 和可编辑侧车 `asset.json`；索引写入 `index.jsonl`。
- `asset.json` 保存发布日期拆分字段、`tags`、`category`、`notes` 和 `selection_enabled`；默认选材使用 `anniversary` 智能回退：去年今日 → 去年本月 → 历史同月 → 今年未发布。严格 `last-year-day` 没有匹配时会明确返回无匹配，不会静默改策略。
- `asset.json` 同时保存可解释的 `season`、`place/places`、`activity_type/activities`、`usage_count` 和 `auto_tags`；这些字段用于面板筛选。自动派生只补齐缺失内容，并保留人工标签与人工覆盖。
- fingerprint 使用账号、发布时间、原文和媒体 SHA-256；重复运行跳过已知内容。
- 原始导出按来源落到 `raw/.weflow/` 或 `raw/.pyweixin/`；导入过程中按条写入 `raw/` 和 `ready/`，中断后可以用 `--resume-only` 重新导入已有暂存结果。已有正式 `ready/` 库不需要重复采集。
- `moments_publisher`：按来源区分自动额度和手动追加，状态为 `QUEUED → PREPARING → PREPARED_FOR_HUMAN_CONFIRM → CONFIRMED_PUBLISHED`，关键异常进入 `FAILED`；当日状态保留 `attempts` 历史，兼容旧版单记录 JSON。
- `prepare_moment` 复用了上游 `post_moments` 的前半段 UI 流程，但不调用 `post_moments` 本身；最终 `发表` 按钮只等待并检查，不点击。
- 当前微信 `4.1.12.55` 的朋友圈窗口 UIA 只暴露外层 Qt 渲染画布时，使用 `wechat_render_surface.py` 版本门控兜底：动态窗口矩形 + 原生文件框 UIA + 文案剪贴板回读 + 绿色发表按钮视觉门禁。若版本画像不匹配立即失败并留证，不扩大坐标、不自动换条。
- `mark-published` 只在用户已经手动点击发表后执行，把 `ready/<work_id>` 移到 `used/<work_id>`，拒绝覆盖已有目录。
- 默认安全模式是 dry-run；只有明确传入 `--live` 才允许打开微信。
- 面板设置中的“自动打开微信”会实际传到发布技能；关闭后如果微信未启动，技能停在等待人工打开的状态，打开后继续同一作品，不换下一条。
- 失败作品不会自动重试；如果确认问题已处理，可在“朋友圈采集整理与发布”中点击“手动重试该作品”，或显式传入 `--retry-failed --work-id <work_id>`，只重试这一条。

## 目录

```text
朋友圈作品库/
├── raw/
│   ├── .pyweixin/              # pyweixin 原始导出暂存，可用于断点恢复
│   └── .weflow/                # WeFlow 原始 .enc 与逐条中间结果
├── ready/                      # 待人工确认发布
│   └── <work_id>/              # content.txt + asset.json + 全部媒体 + metadata.json
├── used/                       # 用户确认发表后归档
├── state/
│   ├── publisher-state.json
│   └── publisher-history.jsonl
├── logs/                       # 阶段、作品、traceback、错误截图
└── index.jsonl
```

真实作品库不要放进仓库；当前本机固定放在 `D:\朋友圈weflow`。

本次目标账号的全量导出位于 `D:\朋友圈weflow\ready`。`D:\朋友圈weflow` 原有的 `media` 文件夹和历史 JSON 未覆盖；新增的 `ready`、`raw`、`logs`、`state`、`used` 是指向本次作品库的目录入口，便于直接从这个目录查看实时结果。

## 明天安装与测试顺序

在仓库的 `src` 目录打开 PowerShell：

```powershell
python -m venv .venv-moments
.\.venv-moments\Scripts\Activate.ps1
python -m pip install -r requirements-moments.txt
```

1. 手动登录 PC 微信，记录微信版本；确认目标是用户本人有权访问的账号/好友。
2. 先做模块检查，不打开微信：

   ```powershell
   python -m moments_publisher --library D:\朋友圈作品库 doctor
   ```

3. 指定一个老微信好友，先只采 10 条：

   ```powershell
   python -m moments_library.collect --friend "老微信备注名" --output D:\朋友圈作品库 --limit 10
   ```

   WeFlow 全量采集使用私有配置中的 UID 和 `--all`，例如：

   ```powershell
   python -m moments_library.collect --source weflow --friend "目标好友备注名" --wxid "<从私有配置读取>" --output D:\朋友圈作品库 --all
   ```

4. 人工核对 10 个作品目录：文案、图片数量、图片顺序、发布时间和账号是否对应。
5. 在不打开微信的情况下验证重复导入路径：

   ```powershell
   python -m moments_library.collect --friend "老微信备注名" --output D:\朋友圈作品库 --limit 10 --resume-only
   ```

   预期不会生成第二批重复作品。

6. 从 `ready/` 确认有一条完整作品后，先看安全 dry-run：

   ```powershell
   python -m moments_publisher --library D:\朋友圈作品库 prepare-today --dry-run
   ```

   默认只从今年的作品中按发布日期从早到晚选材；查看去年的今天可以先执行：

   ```powershell
   python -m moments_library.catalog --library D:\朋友圈作品库 list --policy anniversary
   ```

7. 确认素材和文案无误、微信已登录后，才显式执行真实准备：

   ```powershell
   python -m moments_publisher --library D:\朋友圈作品库 prepare-today --live
   ```

   观察微信是否打开朋友圈、加入正确图片、填入正确文案，并确认程序停在最终“发表”前。程序不会点击“发表”。

8. 用户检查并手动点击“发表”后执行：

   ```powershell
   python -m moments_publisher --library D:\朋友圈作品库 mark-published
   ```

   预期作品从 `ready/` 移到 `used/`，当天再次 `prepare-today` 会被每日一次规则拦截。

## 失败处理

关键步骤失败立即停止，不换下一条、不删除原素材、不判断“可能已经发表”。`logs/` 会记录阶段、作品 ID、traceback；准备阶段尽可能保存错误截图。遇到微信版本/UI 控件不一致时，先保存日志和版本信息，再决定是否做最小适配。

## 已验证项

- Python 3.11 编译通过，Moments 定向测试 12/12 通过：作品导入、去重、断点继续、`asset.json`、今年/去年同日选材、`ready → used`、每日状态门禁和 dry-run。
- 已对本地 `D:\朋友圈weflow` 的 raw/ready 288 个规范化目录补齐 `asset.json`；ready 144 条，其中 2026 年 71 条。所有条目继续保留 `content.txt`，没有只保存图片。
- 临时虚拟环境成功安装 `pywechat127==1.9.8`，`doctor` 成功读取 `Moments.dump_friend_posts` 与 `Moments.post_moments` 签名。
- CLI `prepare-today --dry-run` 在空作品库上安全返回 `NO_READY_WORK`，不探测微信；修复 UTF-8 BOM 兼容后，对 `D:\朋友圈作品库` 能正确选出第一条作品及 9 个媒体路径。
- WeFlow HTTP API 对目标好友返回 10 条动态、90 个媒体记录；文案和发布时间字段可读，原始媒体响应为加密图片字节。
- WeFlow 原生导出返回 144 条动态但 `mediaCount=0`；桌面好友详情仍会显示图片加载失败，但 HTTP 原始媒体接口可以直接拿到加密字节。
- 正式原版的新鲜 API 回归通过：`replace=1&inline=0` 的目标样本代理图片返回 200/JPEG；`replace=0` 的原始图片地址也返回 200/JPEG；`inline=1` 能返回 data URL，但响应体明显膨胀，只作为诊断备用，不作为采集默认路径。
- 修正为 WeFlow 源码同样的 8 字节流长度对齐后，90/90 媒体可解密；JPEG 响应尾部的 25 字节传输尾巴会在保存前截掉。Pillow 逐张验证 90/90 通过，并人工打开抽查图片内容正常。
- 目标好友重新采集 10 条时，原版 API + WeFlow 随附 WASM 真实落盘 10/10 条、90/90 张；每条均有 `.complete`、`content.txt`、9 张 JPEG 和 metadata；对同一暂存批次执行第二次恢复导入为 0 条，未产生重复作品。
- WeFlow partial 恢复、恢复失败写 traceback、UTF-8 BOM 状态、发布器拒绝“适配器已点击发表”、坏媒体拒绝、文案控件回读和微信窗口预检均有自动回归；当前 Moments 定向测试为 11/11 通过。
- 正式 WeFlow 全量采集按分页读取，并按“每条朋友圈一次 WASM”执行；目标 UID 收到并导入 144 条、1264 个媒体文件，`ready/` 每条一个独立目录，0 个 `.partial` 遗留。
- 交叉使用 10 条动态的全部精确 key 解同一失败媒体，0/10 成功；失败不是简单的相邻动态 key 串位。
- `D:\朋友圈作品库\logs\` 已保存接口探针、参数对位、媒体代理、原生导出和验收记录；敏感 token/key 不写入报告。
- 发布器已增加媒体可见性门禁；早期错误探针产生的 10 个坏样本已移动到 `D:\朋友圈作品库\diagnostics\invalid-media-quarantine\20260814`，原文件保留，不再污染 `ready/`。

## 2026-08-14 发布器 live 预检结果

- 已实际执行一次 `prepare-today --live`，选中的作品和素材在进入 UI 前均已通过校验。
- 失败原因不是作品或图片：系统里存在 `Weixin` 进程，但没有可定位的 `Qt51514QWindowIcon` / `微信` 主窗口；旧版上游流程会把空句柄交给 UIA，产生难以判断的 COM 错误。
- 适配器已增加窗口预检，现在会在打开发布流程前直接报“没有可用的 Qt 微信主窗口”，并写入当前阶段、作品 ID、traceback 和错误截图。
- 当天状态保留为 `FAILED`，没有自动重试，也没有把作品标记为已发表。只有用户确认微信已正常显示并登录后，才允许显式加 `--retry-failed --live` 重试。
- 本次证据日志：`D:\朋友圈weflow\logs\publisher-20260814-220601.log`；错误截图：`D:\朋友圈weflow\logs\publisher-error-20260814-220601-20260814-220601.png`。旧截图文件名带双时间戳，代码已修正，后续新日志使用单时间戳。

第二次 live 预检已于 22:25 完成：正常启动 `D:\Program Files\Tencent\Weixin\Weixin.exe` 后能够定位到微信主窗口，说明窗口预检修复有效；随后 pyweixin 返回 `NotLoginError`，流程在打开朋友圈前停止。证据为 `D:\朋友圈weflow\logs\publisher-20260814-222521.log` 和 `D:\朋友圈weflow\logs\publisher-error-20260814-222521.png`。下一次只需完成一次人工登录，即可继续验证图片选择器、图片加载和文案回读。

## 2026-08-14 本机已登录后的手动 UI 回归记录

- 通过当前朋友圈窗口的相对位置打开了系统文件选择器；文件名编辑框和“打开”按钮可以用 Win32 控件 ID 操作，说明“打开图片”这一小段可作为后续适配基础。
- 一次性选择 9 张素材后，当前微信发布面板实际只显示 6 张；之前脚本输出的“已选择 9 张”不能作为成功证据。补选剩余图片和文案回读尚未形成稳定可重复路径。
- 本次没有点击最终“发表”，也没有把作品写成 `PREPARED_FOR_HUMAN_CONFIRM`。在修复“实际图片数和读回文案与计划一致”之前，不能宣称 9 图发布链路已通过。

## 2026-08-14 WeFlow 实测结论

本次实际使用的是本机 WeFlow（HTTP API 127.0.0.1:5031）和好友 `江湖有旅人团建`，没有启动 pyweixin 的 Narrator，也没有点击朋友圈最终发表按钮。

WeFlow 的 HTTP 代理层对 20 位数字 key 存在转 JavaScript `Number` 的精度风险，桌面界面因此仍可能显示加载失败。采集器绕过该代理，直接下载原始媒体，使用 WeFlow 打包源码中的 WASM 算法、精确字符串 key 和 8 字节对齐流生成解密，并清理 JPEG 响应尾巴；这一条链路已经得到 90/90 张可见图片。

本次早期探针曾把加密字节保存成 `.jpg` 作为诊断材料；这些文件未删除，已隔离到 `D:\朋友圈作品库\diagnostics\invalid-media-quarantine\20260814`。新的采集器保留 `.enc` 原始字节，解密不通过完整性校验就立即停止，不导入 `ready`。

## 2026-08-14 WeFlow 6.3.0 隔离补丁回归与最终取舍

- 原正式安装先备份到 `D:\AICode\备份\WeFlow\WeFlow-6.3.0-original-20260814-205226`；备份与正式安装的 `app.asar` SHA-256 均为 `2485D21B...983D5EF`，随后正式安装已恢复并继续使用原版。
- 隔离实例位于 `D:\WeFlow-Isolated-20260814`，补丁只修改 `dist-electron/main.js` 中的媒体 key 归一化：20 位十进制 key 始终保留为字符串，不再转成有精度损失的 JavaScript `Number`。
- 同一目标媒体的未缓存基线请求在原版代理上返回 502；补丁实例返回 200、`image/jpeg`、305288 字节，精确 key 类型为字符串且长度为 20。
- 补丁实例的朋友圈页面真实加载成功：目标好友详情显示 20/144 条，首条可见 9 张图片，图片均完成加载且 natural dimensions 大于 0。截图证据保存在本机 `D:\AICode\运行数据\weflow-patched-ui-target-dialog.png`。
- 隔离用户数据副本没有可直接使用的解密密钥，所以 UI 回归使用了原有本地登录数据作为临时验证上下文；独立隔离 API 回归仍使用 5032 端口并通过。正式安装没有替换，后续需先解决隔离用户数据迁移，再考虑正式切换。
- 本轮重新检查后不替换正式安装：正式原版健康检查返回 200，备份 SHA-256 与正式 `app.asar` 一致；原版当前目标样本的 API 代理和原始媒体路径都能返回 JPEG，采集器也已用原版真实落盘通过。因此补丁不进入正式运行链路，保留为可回滚的隔离实验材料。
- 上游参考也没有形成可直接采用的修复：`hicccc77/WeFlow` 的 HTTP API 文档明确提供 `replace`、`inline` 和媒体解析字段；已关闭的 [PR #924](https://github.com/hicccc77/WeFlow/pull/924) 没有合入，维护者实测未观察到变化。当前方案把采集路径固定为 `replace=0` 原始媒体 + 精确字符串 key + WeFlow WASM，绕开不稳定的桌面代理显示链路。

## 已知未验证项

- 当前电脑微信版本与 `pyweixin` 的实际兼容性尚未验证。
- `dump_friend_posts` 能否稳定取得 10 条、能否向历史底部继续滚动，尚未验证。
- 正式 WeFlow 6.3.0 的桌面窗口对所有历史媒体做一次完整可视化回归尚未完成；当前已完成原版 HTTP/API 和采集落盘回归，故暂不把补丁升级为正式安装。
- `prepare_moment` 的图片选择器、真实文案输入和“停在发表前”仍未在当前电脑微信上完成；当前只验证到缺少主窗口时会安全停止，代码已增加文案控件回读，真实控件不支持回读时会安全失败。
- 尚未配置 Windows Task Scheduler；等明天人工链路通过后再配置。

## 源码依据

当前上游 `Hello-Mr-Crab/pywechat` 的 `pyweixin/WeChatAuto.py` 中，`Moments.post_moments` 的最后一步是 `post_button.click_input()`。本项目没有调用该方法，而是复用它打开朋友圈、打开文件选择器、填图、定位发布面板、填文案和等待“发表”按钮的流程，并把最后点击明确留给用户。
