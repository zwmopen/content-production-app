# 内容制作工作台 · 全量备份与一键恢复指南 (Full Backup & Disaster Recovery Guide)

> **基线版本**：`v2.7.0-stable`（大改重构前最终稳定基线）  
> **归档时间**：`2026-10-31 12:35 +08:00`  
> **基线用途**：在启动内容制作模块（SOP、提问流水线、状态机）大型重构与代码改造前，**对当前已验证正常可用的生产环境进行 100% 物理级冷备份**。若重构期间发生任何异常、逻辑混乱或不可逆回归，可通过本指南在 **30 秒内全量恢复** 到本稳定状态。

---

## 1. 备份包权威信息（真源与校验和）

| 档案名称 | 物理路径 | 文件大小 | SHA-256 校验和 |
|---|---|---|---|
| **正式稳定版归档** | `releases/content-production-app-v2.7.0-stable.zip` | 48.73 MB | `e6fbb7c632641e7b0b39efa902773f67f239e62ee63f950ae5ad7e69ab0a4cbd` |
| **重构前基线快照 (只读备份)** | `releases/content-production-app-pre-refactor-baseline-20261031.zip` | 48.73 MB | `e6fbb7c632641e7b0b39efa902773f67f239e62ee63f950ae5ad7e69ab0a4cbd` |

- **配套签名清单**：`releases/SHA256SUMS.txt`
- **版本审计台账**：`releases/release-ledger.jsonl`
- **详细元数据描述**：`releases/v2.7.0/manifest.json`

---

## 2. 备份包包含的核心能力与资产状态

该稳定版包含以下所有已验证的完整源码、配置与资产：
1. **多账号全槽位架构**：
   - A~F 全 6 个槽位账号真实登录态与配置，主力账号已排布前置：`a · zwmrpg`（Plus）、`b · upvote`（Plus）、`c · donnap`（Plus）、`d · orland`（Free）、`e · rpgzwm`（Free）、`f · allele`（Plus 禁用态）。
   - 顶栏 Tab 已升级为清爽小写字母显示，Plus 账号全量生效金色立体边框（`#f59e0b`），支持流畅 HTML5 拖拽排序。
2. **纯净环境隔离机制**：
   - 彻底移除了改写 User-Agent、WebGL、AudioContext 和 WebRTC 的假指纹注入，彻底移除了旧 Cookie 强行覆盖注入；
   - 采用纯净原生 Partition 物理隔离，100% 根除 Google OAuth `signin/rejected` 与 OpenAI 登录风控。
3. **P0 确定性动作与服务代码**：
   - `src/lib/production-action-service.js` 统一动作总线；
   - `src/lib/production-metadata-schema.js` 单一 metadata 标准；
   - `src/lib/production-upload-action.js` 上传确定性动作；
   - `src/lib/production-plan-data.js` PLAN_DATA 解析；
   - `src/lib/production-qa-contract.js` 与 `production-vision-provider.js` 质检退避体系；
   - `src/lib/production-product-archive.js` 成品落盘骨架。

---

## 3. 一键全量恢复操作 SOP（30 秒救灾）

如果在后续的大改过程中需要全量回退，按以下两步操作即可恢复：

### 步骤 1：终止正在运行的 4331 进程
```powershell
# 在 PowerShell 中执行，停止当前服务
Stop-Process -Name electron -Force -ErrorAction SilentlyContinue
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
```

### 步骤 2：解压覆盖恢复全量代码
```powershell
# 进入项目根目录
cd "D:\AICode\工具开发\projects\content-production-app"

# 从备份快照全量强行覆盖解压（自动还原所有源码与配置）
Expand-Archive -Path "releases\content-production-app-v2.7.0-stable.zip" -DestinationPath "." -Force

# 启动统一工作台
.\launch-unified.bat
```

> [!TIP]
> 解压完成后，直接运行 `launch-unified.bat` 即可拉起恢复后的稳定服务，所有账号、设置、顶栏小写 Tab 及 P0 动作将瞬间回到 2026-10-31 12:35 基线！

---

## 4. Git 节点保护

- 本地 Git 提交分支：`main`
- 对应 Git 标签：`v2.7.0`（包含本备份发布的所有元数据）
