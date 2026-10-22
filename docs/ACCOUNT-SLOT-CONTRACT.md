# 账号槽位与就绪判定 · 统一契约（Single Source of Truth）

> 本文件是「内容制作 App」账号体系的**唯一口径**。
> 任何 AI / 任何人改这块代码前先读这里；改完必须同步改本文件的版本记录。
> 违反本文件的改法一律视为回退，不能以"我觉得这样更好"为由覆盖。

- 契约版本：**C-4**（2026-10-22）
- 适用副本：`D:\AICode\工具开发\projects\content-production-app`（**当前唯一在跑的副本**，dev 模式，端口 4331 / CDP 9431）
- 同目录兄弟副本 `content-production-app-dev`、`content-production-app-legacy-A` **不是**运行体，禁止在此二者上改完就当已修好。

---

## 0. 先搞清楚：哪个副本在跑？

判断方法（不要靠猜）：

1. `launch-unified.bat` 里 `set PORT=4331`、`set TB_REMOTE_DEBUGGING_PORT=9431`；
2. `main.js` 的 `isDevMode()` 用 `process.execPath` 的文件名是否为 `electron.exe` 判断，是则**直接跑 `src/` 源码**，不读打包产物；
3. 交叉验证：`netstat -ano | findstr :4331` 拿到 PID → `tasklist /FI "PID eq <pid>"` 看是不是 `electron.exe`。

> 结论：改 `content-production-app/src/**` 才有效，且**重启工作台后**才生效。

---

## 1. 五个「唯一真源」

| 事实 | 唯一真源 | 谁说了算 | 禁止的做法 |
|---|---|---|---|
| 某槽位是否已登录、登录的是谁 | ChatGPT 服务端 `GET /api/auth/session` | 服务端返回的 `user` / `account.planType` | ❌ 搜页面文字里有没有"登录/sign in" |
| 页面是否可投产（ready） | DOM 结构 + 上面的会话结论 | `composerReady && extensionReady && chatConversation && !authenticationRequired` | ❌ 只看 `document.readyState` |
| 槽位字母 A/B/C/D… | `gpt-browser-profiles.json` 里 `profiles` 的**数组下标** | `String.fromCharCode(65 + index)` | ❌ 硬编码 `account-1 → A` |
| 槽位内部 ID | `account-N`，**永不因换位而改变** | 档案文件里的 `id` | ❌ 拖动换位时改 `id` |
| 队列/进度 | `unified-runtime/gpt-production-runtime.json` | 运行时状态文件 | ❌ 用前端内存状态当进度 |

---

## 2. 四条铁律（都是踩过坑换来的）

### 铁律 1｜登录态不许用文字嗅探

**曾经的做法（已废）**：把 `input/button/h1/h2` 前 40 个节点的文字拼起来，命中 `"登录" / "sign in" / "log in"` 且当时没找到输入框，就判 `authenticationRequired = true`。

**为什么必须废**：ChatGPT 首页、半加载页、中文侧边栏都带"登录"二字。于是**"窗口还没加载完"被误判成"掉登录"** → 系统触发 `refresh-limit-browser-recreate` 重建 → 还是首页 → 26 次死循环 → 任务永远投不出去。日志里 100+ 条 `GPT_AUTH_REQUIRED` 大部分是这个假象。

**现在的做法**：
- 结构判据只保留三种确定性来源：① 域名/路径是 `auth.openai.com`、`/auth/*`；② 页面上真有登录表单（`input[type=password]` 等）；③ 明确提示"会话已过期"。
- 最终以 `probeGptSessionAuth()` 读 `/api/auth/session` 为准，结果缓存 45s。
- 两者冲突时**服务端赢**：服务端说已登录，就当已登录。

### 铁律 2｜结构判断只写一份

就绪探测和诊断接口共用 `GPT_PAGE_STRUCTURAL_STATEMENTS` 同一个常量。
曾经这两处各写一套，结果诊断说"未登录"、状态面板说"就绪"，互相打架。
**新增第四个调用方必须复用它，不许复制粘贴。**

### 铁律 3｜点击类操作不许无界 await

- `desktop:gpt-show`（切槽位）：页面探测最多等 **800ms**，超时用已知状态兜底。
- `desktop:gpt-navigate`（刷新/主页/地址栏）：`loadURL` 只等 **500ms**，返回 `stillLoading: true`，剩下交给页面自己跑。

**原因**：`loadURL` 的 Promise 要等 `did-finish-load`，ChatGPT 首屏 3~8 秒；渲染进程繁忙时 `executeJavaScript` 可能挂十几秒（日志 `gpt-execute-timeout label=inspect/theme` 就是它）。
以前无界 `await` 这两个，用户的感觉就是"点了刷新要等好几秒才动"。

### 铁律 4｜未登录账号不许进生产池

`desktop:production-active` 现在是**准入闸门**：加号前先探一次就绪，`authenticationRequired` 或没有输入框就直接拒绝，返回 `rejected: true` + `code` + `reasons`，并写日志 `gpt-worker-admit-rejected`。

以前是无条件 `productionTaskAccounts.add(...)`，于是 5 个未登录窗口混进 worker 池，任务一投出去就 `GPT_AUTH_REQUIRED` 空转。

---

## 3. 槽位拖动（2026-10-21 新增）

- 顶栏 `A B C D …` 可以直接拖动换位：把 **D 拖到 B 的位置，D 就变成 B**。
- 实现：`drag` → `reorderGptAccounts(sourceId, targetId)` → IPC `desktop:gpt-profile-reorder` → 重写 `profiles` 顺序 → 字母按新下标重算。
- **内部 ID（`account-1 … account-9`）始终不变**，变的只是顺序；会话分区 `persist:teambuilding-gpt-production-account-<N>` 因此也保持不变，**拖动不会丢登录态**。
- 拖动结束后 600ms 内抑制 click，避免"拖完顺手把账号也切了"。

---

## 4. D 槽位与旧独立实例的区分（2026-10-22）

- 槽位字母仍只按统一 `gpt-browser-profiles.json` 的当前数组位置计算；账号内部 ID 不改号。
- 本轮读取的统一 profile 顺序为 `account-1, account-2, account-3, account-5, account-6`，因此本次观测下 D 槽位是 `account-5`，E 槽位是 `account-6`。用户重排 profile 后字母会随数组位置变化，此快照不替代实时读取。
- 旧 `instance-D/electron-userdata` 里的 `account-4` 是独立旧 profile，不是统一运行时当前的 D 槽位。统一运行时合并脚本不得把该旧 `account-4` 插到 `account-5` 前面；仅在旧 D 源确实存在 `account-5` 分区时才允许复制该同 ID 分区。缺失时保留现有 unified `account-5` 数据，不改写 ID、不搬 Cookie/登录态。
- 当前统一运行时的 A 进程仍在运行；本轮未执行合并脚本、未重启实例、未修改 profile JSON 或浏览器分区。

## 5. 术语白话对照

| 说的词 | 人话 |
|---|---|
| 准入条件 | 判断这个窗口**够不够格接活**：已登录 + 输入框在 + 停在对话页 |
| 对话页 | 地址形如 `chatgpt.com/c/xxxx` 的**具体聊天**页；`chatgpt.com/` 首页不算 |
| productionReady | 上面几项全满足 = 这个窗口能直接派活 |
| 槽位 / 内部 ID | 槽位＝顶栏那个字母；内部 ID＝`account-5` 这种，永远不变 |
| 重建（recreate） | 把整个浏览器窗口销毁重开，成本高，只在真卡死时用 |

---

## 6. 改动流程（强约束）

1. 改契约 → 必须同时改 `src/public/workbench-ui.test.js` 里对应断言；
2. 改完跑 `npm test`（在 `src/` 下），**失败数不得高于改动前基线**；
3. 本文件顶部契约版本 +1，并在第 7 节记录一行；
4. 更新 `CHANGELOG.md` / `VERSION` / `HANDOFF.md`。

> 只改代码不改断言 = 下次别人跑测试看到红，会以为你写坏了又改回去。

---

## 7. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-21 | C-1 | 建立契约：五个唯一真源、四条铁律白纸黑字落盘 |
| 2026-10-21 | C-2 | 登录判定改为服务端会话为准；结构语句合并为单一份；show/navigate 加超时；生产池加准入闸门；顶栏槽位支持拖动换位；新增 HTTP 服务看门狗（`server-watchdog-*` 日志） |
| 2026-10-22 | C-3 | 巡检门禁：注册表 mtime 实时重读，未注册/disabled 槽位跳过一切后台探测（有在途任务除外）；服务端实锤未登录且页面不可见时后台探测走缓存合成不敲渲染进程；主题注入改错峰串行、隐藏窗口跳过、gpt-show 补注入；准入闸门新增 GPT_SLOT_DISABLED；状态接口透出 slotDisabled；新增 `gpt-probe-skipped` 节流日志 |
| 2026-10-22 | C-4 | 明确统一 profile 数组位置决定 D 槽位、account-5 内部 ID 不改；阻止旧 instance-D/account-4 被合并为统一 D，并在同 ID 源分区缺失时保留现有 unified account-5 数据 |
