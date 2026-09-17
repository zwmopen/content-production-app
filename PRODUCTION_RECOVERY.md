# 江湖有旅人 · 内容生产流水线灾备与恢复指南 (PRODUCTION_RECOVERY.md)

> **版本标识**：`v2.6.0-stable-20260917`  
> **基线说明**：本指南为经过实盘验证（已连续产出 270+ 套标准画册成品）的工业级稳定流水线恢复说明。哪怕未来系统重装、代码分支被改乱、或新环境部署，严格依照本手册可在 15 分钟内 100% 还原完整生产能力。

---

## 一、 运行环境与依赖清单

### 1. 基础操作系统与运行时
- **操作系统**：Windows 11 Pro 64-bit (OS Build 22631+)
- **Python 环境**：Python 3.11.x（建议官方 64 位安装版，路径：`C:\Users\z\AppData\Local\Programs\Python\Python311\python.exe`）
  - 核心第三方依赖库：
    ```bash
    pip install websockets pillow requests urllib3
    ```
- **Node.js / Electron 环境**：
  - Node.js v18.x ~ v20.x
  - 项目内置 Electron 依赖位于：`D:\AICode\工具开发\projects\content-production-app\src\node_modules`
- **飞书 CLI 工具链**：
  - `lark-cli`（用于多维表格读写、单元格图片嵌入与即时群通知，已配置本地授权免密会话）

### 2. 账号与浏览器底座矩阵
- **实例 A (CDP 9431 / HTTP 4331)**：
  - 承载账号：`zwmrpg`（主账号 1 · ChatGPT Plus）
  - 用户数据目录：`D:\AICode\运行数据\江湖有旅人\内容生产App\instance-A\electron-userdata`
- **实例 C (CDP 9433 / HTTP 4333)**：
  - 承载账号：`z x Plus`（账号 3 · ChatGPT Plus）
  - 用户数据目录：`D:\AICode\运行数据\江湖有旅人\内容生产App\instance-C\electron-userdata`
- **飞书权限**：
  - 专职机器人/小号已授权目标表格编辑权限与目标群发消息权限。

---

## 二、 关键目录物理结构图

| 资产类型 | 物理绝对路径 | 说明 |
| :--- | :--- | :--- |
| **源码工程** | `D:\AICode\工具开发\projects\content-production-app\` | 生产中控服务、守护脚本与主脑程序 |
| **核心执行脚本** | `D:\AICode\工具开发\projects\content-production-app\scripts\` | `dual_browser_autonomous_producer.py` 等 |
| **生产专属技能** | `D:\AICode\AI\skills\技能包\技能\chatgpt-cdp-production\` | CDP协议中控、MCP服务与两阶段SOP规范 |
| **辅助API技能** | `D:\AICode\AI\skills\技能包\技能\codex-teambuilding-api-replication\` | Codex API 原生直出与长图文复刻规范 |
| **原始素材库** | `D:\AICode\江浙沪素材库\`<br>`D:\AICode\项目推进\projects\江湖有旅人\主项目\01-素材库\` | 包含原图文、`.tags.json` 与原始文案 |
| **成品创作暂存区** | `D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）\_制作中\` | 生产中作品，带 `.producing.lock` 锁 |
| **合格成品总库** | `D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）\已发送0次（抖音小红书可发）\` | 完工作品物理归宿，已累积 270+ 套 |
| **母版与模板库** | `D:\AICode\项目推进\projects\江湖有旅人\主项目\02-模板库\` | 冻结模板、母版清单与会话台账 |
| **飞书对照总表** | 工作簿 Token: `D7OMsirIChkd2gt8TMBcPHD9ndc`<br>子表: `ChatGPT客户端API生产` (`pVD1I4`) | 原素材 vs 成品大图双行对比总表 |
| **运行时日志与台账** | `D:\AICode\运行数据\江湖有旅人\内容生产App\` | `dual_browser_autonomous_producer.log` 等 |

---

## 三、 从开机零状态启动 SOP (Step-by-Step)

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

## 四、 生产线验收与自检标准

1. **落盘目录规范**：
   - 命名格式：`YYYYMMDD_HHMMSS-网页CDP-标题`（**严禁空格**）。
   - 内部文件结构：
     - `01.png` ~ `08.png` / `10.png`（纯净 3:4 竖屏，1086×1448 像素）；
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

## 五、 故障处理与自愈恢复方案

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

## 六、 灾备版本锚点与恢复入口

- **Git Commit**：参见本仓库 `v2.6.0-stable-20260917` 对应提交。
- **物理离线备份位置**：`D:\AICode\Backups\production_stable_v2.6.0_20260917\`
