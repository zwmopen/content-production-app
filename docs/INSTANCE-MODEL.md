# A-D 四实例与四条开发支线模型

本项目只有一份主干源码；从主干建立四条 Git 支线和四个 worktree。每个 worktree 都可以单独修改、测试和启动一个桌面实例。一个实例可以独立生产，其他实例可以停着或用于另一种模板/流程调试，不会因为某个窗口改代码而自动打断正在生产的窗口。

## 实例分工

| 实例 | 账号 | HTTP | Electron/CDP | 运行目录 | Git 支线 / worktree |
|---|---|---:|---:|---|---|
| A | account-1 | 4331 | 9431 | `D:\AICode\运行数据\江湖有旅人\内容生产App\instance-A` | `instance-a-account-1` / `content-production-app-instances\A` |
| B | account-2 | 4332 | 9432 | `D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B` | `instance-b-account-2` / `content-production-app-instances\B` |
| C | account-3 | 4333 | 9433 | `D:\AICode\运行数据\江湖有旅人\内容生产App\instance-C` | `instance-c-account-3` / `content-production-app-instances\C` |
| D | account-4 | 4334 | 9434 | `D:\AICode\运行数据\江湖有旅人\内容生产App\instance-D` | `instance-d-account-4` / `content-production-app-instances\D` |

启动脚本 `start-instance-a.ps1` 至 `start-instance-d.ps1` 是四个实例的显式入口。脚本为每个实例设置唯一的实例 ID、账号、HTTP 端口、CDP 端口、运行目录、Electron `userData` 和单实例锁名称；`src/lib/instance-account-policy.js` 是代码侧的 A-D 映射真源。账号显示名、启用/暂停/手动状态仍从当前实例配置和运行数据读取，不能从旧聊天或旧显示名猜测。

## 隔离与共享边界

每个实例独立拥有：

- Electron `userData`、GPT 登录态和浏览器分区；
- HTTP/CDP 端口、桌面进程、单实例锁；
- `desktop.log`、运行态、会话日志、队列、检查点、归档账本和任务索引；
- 当前实例可修改的代码支线与测试工作区。

四个实例只按业务需要共享：

- 素材库、模板库和成品库；
- 素材生命周期锁、成品包存在性校验和归档幂等规则。

共享素材不等于共享任务状态。同一素材不能被两个实例同时领取；未知归属、重复 requestId/archiveEventKey 或实际成品包不存在的记录不能冒充完成套数。运行数据、登录态、Cookie、Token 和未脱敏作品不进入 Git 仓库。

## 使用与晋升规则

在某条支线上修改只影响该支线的 worktree；要让其他实例使用，必须将已验证提交合并或挑选到对应支线。不能把一个支线的工作区直接热加载到另一个实例，也不能用复制运行目录的方式共享浏览器登录态。

建议流程：先在目标支线完成静态检查和相关回归，再在该支线对应窗口做最小桌面验收；真实生产验收必须看日志、检查点、归档事件和成品文件，不能只看页面“运行中”。本次建立 A-D 结构时不自动启动 B/C/D、不登录或迁移账号、不发送 GPT 请求。
