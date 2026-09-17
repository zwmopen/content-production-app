# 江湖有旅人 · 内容生产流水线双模式灾备与恢复指南 (PRODUCTION_RECOVERY.md)

> **版本标识**：`v2.6.0-stable-20260917`  
> **基线说明**：本指南为经过实盘验证（已连续产出 270+ 套标准画册与长图文成品）的工业级双轨生产线恢复手册。哪怕未来系统重装、代码分支被改乱、或在新机器部署，严格依照本手册可在 15 分钟内 100% 还原完整生产能力。

---

## 一、 生产线双轨模式架构深度对照 (CDP 模式 vs API 模式)

当前工业级内容生产流水线包含两种高度互补的生产模式，两者共享相同的素材事实账本、三端合一文案规范与飞书验真闭环，但在执行机制与适用场景上物理隔离：

| 核心维度 | 模式一：双浏览器脱机 CDP 生产流 (ChatGPT Web CDP) | 模式二：Codex API 原生直出流 (Codex Native Replication) |
| :--- | :--- | :--- |
| **底层驱动方式** | 本地 Chromium/Electron 实例直连 Chrome DevTools Protocol (CDP) | 调用 Codex / OpenAI 原生生图与文本 API 接口 |
| **端口与协议** | WebSocket 直连：实例 A (`9431`)、实例 C (`9433`) | HTTPS 官方 API 接口调用 |
| **Token / 成本** | **0 API 消耗**（复用已有的 ChatGPT Plus 网页订阅会员） | 按官方 API 标准扣除 Token 与生图点数 |
| **账号矩阵** | 实例 A (`zwmrpg` 大号)、实例 C (`z x Plus` 小号) | 专属 API Key 凭证与授权账户 |
| **出图页数机制** | **固定 8~10 张画册轮播图**（受网页端单轮对话上下文最佳表现约束） | **原素材驱动动态 5~20 张长图文**（完全无 10 张上限，由原素材图数动态驱动） |
| **交互与握手机制**| **严格两阶段流水线握手**：<br>① 阶段一生成大纲与结构，绝对不生图；<br>② 人机/脚本扣 1 确认后，阶段二批量出图 | **分层批次直出流水线**：<br>根据原素材有效图数直接绑定页码与分区置换，按批次连续直出 |
| **核心执行主脑** | `scripts/dual_browser_autonomous_producer.py` | `codex-teambuilding-api-replication` 技能编排引擎 |
| **核心启动入口** | `启动双机脱机生产_独立进程.bat`<br>`启动双浏览器全自动生产守护.bat` | 技能交互式调用 / API 自动化运行脚本 |
| **成品命名规范** | `YYYYMMDD_HHMMSS-网页CDP-标题`（严禁英文空格） | `YYYYMMDD_CodexAPI-标题` 或 `YYYYMMDD_HHMMSS-CodexAPI-标题` |
| **额度控制与冷却**| **OpenAI 5 小时滑窗保护**：出满后自动休眠降温，挂载 5 分钟测活定时器自愈 | **API 429 速率重试与批次隔离**：遇到限流指数退避，断点保存在 `_制作中` |
| **飞书多维表格对照**| 写入工作簿 `D7OMsirIChkd2gt8TMBcPHD9ndc`，子表 `ChatGPT客户端API生产` (`pVD1I4`)<br>新增双行（原素材 vs 成品），并由脚本自动回读 token 验真 | 同一子表 (`pVD1I4`)，若超出单行 10 图限制，自动追加【本地成品素材·续1】续行，绝不漏图 |
| **手机相册格式** | 严格 Format 3 单一 `文案.txt`，辅助文件强加 `_` 前缀（Android/iOS 0 报错一键复制） | 严格遵守同一单一 `文案.txt` 与 `_` 前缀隔离铁律 |

---

## 二、 运行环境与依赖清单

### 1. 基础操作系统与运行时
- **操作系统**：Windows 11 Pro 64-bit (OS Build 22631+)
- **Python 环境**：Python 3.11.x（建议官方 64 位安装版，路径：`C:\Users\z\AppData\Local\Programs\Python\Python311\python.exe`）
  - 核心第三方依赖库：
    ```bash
    pip install websockets pillow requests urllib3 psutil
    ```
- **Node.js / Electron 环境**：
  - Node.js v18.x ~ v20.x
  - 项目内置 Electron 依赖位于：`D:\AICode\工具开发\projects\content-production-app\src\node_modules`
- **飞书 CLI 工具链**：
  - `lark-cli`（用于多维表格读写、单元格图片嵌入与即时群通知，已配置本地授权免密会话）
- **云端同步工具链**：
  - 便携版 Rclone：`D:\AICode\工具开发\toolchains\rclone\rclone.exe`（Google Drive 5TB 同步）
  - 阿里云盘 CLI：`D:\Program Files\aliyunpan\aliyunpan.exe`（配置目录：`D:\Program Files\aliyunpan\config`）

### 2. 账号与浏览器底座矩阵 (CDP 模式)
- **实例 A (CDP 9431 / HTTP 4331)**：
  - 承载账号：`zwmrpg`（主账号 1 · ChatGPT Plus）
  - 用户数据目录：`D:\AICode\运行数据\江湖有旅人\内容生产App\instance-A\electron-userdata`
- **实例 C (CDP 9433 / HTTP 4333)**：
  - 承载账号：`z x Plus`（账号 3 · ChatGPT Plus）
  - 用户数据目录：`D:\AICode\运行数据\江湖有旅人\内容生产App\instance-C\electron-userdata`
- **飞书权限**：
  - 专职机器人/小号已授权目标表格编辑权限与目标群发消息权限（流水线通知群：`oc_a620407b836cb421f8bb72c0d6f596f1`）。

---

## 三、 关键目录物理结构图

| 资产类型 | 物理绝对路径 | 说明 |
| :--- | :--- | :--- |
| **源码工程** | `D:\AICode\工具开发\projects\content-production-app\` | 生产中控服务、守护脚本与主脑程序 |
| **核心执行脚本** | `D:\AICode\工具开发\projects\content-production-app\scripts\` | `dual_browser_autonomous_producer.py` 等 |
| **CDP 生产专属技能** | `D:\AICode\AI\skills\技能包\技能\chatgpt-cdp-production\` | CDP协议中控、MCP服务与两阶段SOP规范 |
| **API 生产专属技能** | `D:\AICode\AI\skills\技能包\技能\codex-teambuilding-api-replication\` | Codex API 原生直出与动态 5~20 张长图文复刻规范 |
| **分发传输专属技能** | `D:\AICode\AI\skills\技能包\技能\device-folder-transfer\` | 局域网分发软件、单播穿透探测与相册同步 |
| **原始素材库** | `D:\AICode\江浙沪素材库\`<br>`D:\AICode\项目推进\projects\江湖有旅人\主项目\01-素材库\` | 包含原图文、`.tags.json` 与原始文案 |
| **成品创作暂存区** | `D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）\_制作中\` | 生产中作品，带 `.producing.lock` 任务锁 |
| **合格成品总库** | `D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）\已发送0次（抖音小红书可发）\` | 完工作品物理归宿，已累积 270+ 套 |
| **母版与模板库** | `D:\AICode\项目推进\projects\江湖有旅人\主项目\02-模板库\` | 冻结模板、母版清单与会话台账 |
| **飞书对照总表** | 工作簿 Token: `D7OMsirIChkd2gt8TMBcPHD9ndc`<br>子表: `ChatGPT客户端API生产` (`pVD1I4`) | 原素材 vs 成品大图双行对比总表 |
| **运行时日志与台账** | `D:\AICode\运行数据\江湖有旅人\内容生产App\` | `dual_browser_autonomous_producer.log` 等 |

---

## 四、 模式一：双浏览器 CDP 生产流启动与运行 SOP

若电脑经历重启或断电，按以下三步一键点火恢复：

### 步骤 1：拉起双浏览器底层守护
双击执行：
```text
D:\AICode\启动双机脱机生产_独立进程.bat
```
- **背后执行**：
  - 自动清理残余的 `SingletonLock`；
  - 以后台独立窗口启动 `run-instance-a-daemon.js`（拉起实例 A：服务端口 4331，CDP 调试端口 9431）；
  - 启动 `run-instance-c-daemon.js`（拉起实例 C：服务端口 4333，CDP 调试端口 9433）。
- **核验标准**：
  在终端执行 `Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 9431, 9433 }`，确认 9431 与 9433 端口均处于监听状态。

### 步骤 2：启动主脑调度引擎
双击执行：
```text
D:\AICode\启动双浏览器全自动生产守护.bat
```
- **背后执行**：
  - 调用 Python 3.11 运行 `scripts/dual_browser_autonomous_producer.py`；
  - 自动建立与 9431/9433 的 WebSocket CDP 链接；
  - 自动扫描素材库中 `production.lifecycleState == "已打标待生产"` 的素材；
  - 启用安吉、莫干山、杭州、宁波等多地域 Round-Robin 均衡调度。

### 步骤 3：启动手机分发源服务 (可选)
双击执行：
```text
D:\AICode\启动手机本地更新源(端口4348).bat
```
- **背后执行**：拉起 4348 端口本地相册分发更新源，供局域网手机随时拉取作品。

---

## 五、 模式二：Codex API 原生直出流启动与运行 SOP

Codex API 模式适用于高质量长图文直出（5~20张）与原素材高保真复刻，执行步骤如下：

### 步骤 1：确认素材入队状态
- 检查目标素材包是否包含清晰原图与事实标签文件（`.tags.json`）；
- 确认素材事实账本：明确地点、路线、天数、项目；未知信息不凭空捏造。

### 步骤 2：执行原素材驱动生图流水线
- 触发 `codex-teambuilding-api-replication` 技能；
- **动态图数绑定**：按原素材有效图数直接设定计划出图数 $M$（5~20 张，绝不死板写死 10 张）；
- **团队人数合规**：成图团队人数门槛强制归一化为“10人起”（保留“适合10人起团队”句式）；
- **涉旅消杀合规**：全面抹除联系电话、微信、扫码、预约、私信等强导流词；
- **三阶段状态机流转**：
  1. 初始产物第一时间存入 `成品库\_制作中\<YYYYMMDD_CodexAPI-标题>\`（挂载 `.producing.lock`）；
  2. 生成单一 Format 3 标准 `文案.txt`，其他辅助文件强制加 `_` 前缀；
  3. 写入飞书多维表格（超过 10 张自动追加续行），并使用 `+cells-get` 回读 token 验真；
  4. 验真通过后向群发送即时通知卡片，清理 C 盘临时生图目录；
  5. 原子剪切（`shutil.move`）移入 `已发送0次（抖音小红书可发）` 正式库。

---

## 六、 生产线验收与自检标准

1. **落盘目录规范**：
   - 命名格式：`YYYYMMDD_HHMMSS-网页CDP-标题` 或 `YYYYMMDD_CodexAPI-标题`（**严禁空格**）。
   - 内部文件结构：
     - `01.png` ~ `08.png` / `10.png` / `20.png`（纯净 3:4 竖屏，1086×1448 像素）；
     - `文案.txt`（以 `<<<COPY_FORMAT:3>>>` 开头，三端合一且首行为纯净标题）；
     - `manifest.json`（记录 `completionRate == 100.0%` 与精确元数据）；
     - 辅助记录全部带 `_` 前缀（如 `_质检记录.txt`）。
2. **飞书多维表格验收**：
   - 自动写入新增两行：`第N套【本地原素材】` 与 `第N套【本地成品素材】`；
   - 单元格内嵌大图可直接放大预览；
   - 自动化脚本自动用 `+cells-get` 回读 revision 与图片 token，双重验真。
3. **流水线群通知闭环**：
   - 完结后向飞书群 `oc_a620407b836cb421f8bb72c0d6f596f1` 发送图文完工卡片。

---

## 七、 故障处理与自愈恢复方案

### 1. 网络断流或代理干扰
- **现象**：CDP 报错 `ECONNREFUSED` 或 WebSocket 握手超时。
- **排查与自愈**：
  - 脚本已内置 `_sanitize_lan_proxy()`，强制将局域网网段（`127.0.0.1`, `192.168.*` 等）加入系统 `NO_PROXY` 白名单，物理隔绝代理工具劫持；
  - 若浏览器页面报错，守护进程每 30 秒自动重连，无需人工干预。

### 2. OpenAI 5 小时滑动窗口额度触顶
- **现象**：界面弹出官方额度限制提示。
- **处理机制**：
  - 主脑自动识别提示文本并记录精确解冻时间；
  - 触发飞书通知播报当前冷却期；
  - 任务原地保留在 `_制作中`（挂载 `.producing.lock`）；
  - 挂载 5 分钟定时自愈探针，到达解冻时刻后自动测活并无缝继续出图，**绝对不丢进度**。

### 3. 程序意外崩溃或断电重启
- **断点接力铁律**：
  - 重启后，主脑首先检查 `_制作中` 目录下的未完结任务；
  - 读取该任务的 `manifest.json` 与已有图片列表（如已出 4 张，缺 P5~P9）；
  - 自动在原 ChatGPT 会话分支中输入“继续生成剩余页面”，补全剩余图片；
  - 补齐后统一进行 Pillow 质检、飞书写入与移库。**绝不推倒重跑，也绝不生成两套重复文件夹**。

### 4. 坏素材与死循环物理隔离
- 若遇到模型死板拒答、素材图损坏或违规内容：
  - 脚本自动将该素材剪切移入 `_异常素材（脚本失败隔离）` 目录；
  - 避免双实例反复拾取同一故障素材造成死循环死锁。

---

## 八、 双云盘灾备金库拉取与恢复 SOP

发生换电脑、系统重装或代码损坏时，可从以下两个云端专属大金库秒级拉取恢复：

### 选项 A：从 Google Drive (5TB 空间专属小号) 拉取
```powershell
# 执行 Rclone 一键恢复命令
& "D:\AICode\工具开发\toolchains\rclone\rclone.exe" copy "gdrive-rpgzwm:生产系统发布备份仓库/v2.6.0-stable-20260917" "D:\AICode\Backups\production_stable_v2.6.0_20260917" -v
```

### 选项 B：从 阿里云盘 (专属账号：有意之中见惊喜) 拉取
```powershell
# 设置配置环境并下载整包
$env:ALIYUNPAN_CONFIG_DIR = "D:\Program Files\aliyunpan\config"
& "D:\Program Files\aliyunpan\aliyunpan.exe" download "/我的备份/生产系统发布备份仓库/v2.6.0-stable-20260917" --saveto "D:\AICode\Backups"
```

拉取解压后：
1. 双击 `启动双机脱机生产_独立进程.bat`
2. 双击 `启动双浏览器全自动生产守护.bat`
3. 流水线立即原地复活！
