# 团建中控｜AI 控制、Skill 与统一能力层设计

状态：当前有效方向
更新：2026-08-07

## 一句话目标

> 团建中控最终不是只能靠鼠标操作的软件，而是一个“人可操作、软件可自动运行、AI 可直接调用”的可编程内容生产引擎。

未来同时支持三种入口：

1. 用户在 UI 中手动操作；
2. 软件按预设工作流自动执行；
3. ChatGPT、Codex 或其他 AI 通过 Skill、MCP、API 或软件内置 AI 助手对话式控制软件。

三种入口必须调用同一套底层能力，禁止 UI、自动脚本、AI 各自维护一套业务逻辑。

---

## 一、目标架构

```text
人工 UI ─────────────┐
自动工作流 ──────────┼──→ 统一能力层 / Core API ─→ 状态机 ─→ GPT 网页执行器 / 文件系统 / 数据库
外部 AI Skill/MCP ───┤
软件内置 AI 助手 ────┘
```

关键原则：

> UI 是入口，自动模式是入口，AI 也是入口；真正的业务能力只能有一份。

---

## 二、两种 AI 形态都要支持

### 2.1 外部 AI 控制

适合 ChatGPT、Codex、Claude、本地 Agent 或其他支持 Skill/MCP/API 的 AI。

用户可以直接说：

- “生产 5 条转化内容，优先未使用素材。”
- “看一下账号 2 为什么停了。”
- “把已完成作品加入手机待发。”
- “暂停全部生产，保留检查点。”

### 2.2 软件内置 AI 小助手

以后标准软件可以直接内置一个 AI 助手，不要求用户离开软件去找外部 AI。

内置助手应该能：

- 读取当前页面和任务状态；
- 解释当前软件在做什么；
- 根据自然语言创建、修改和执行任务；
- 调用同一套 Core API；
- 查看日志并诊断问题；
- 在执行高风险动作前要求确认。

外部 Skill 和内置助手不是两套系统，只是两个不同入口。

---

## 三、为什么不能只让 AI“点按钮”

AI 控制不能主要依赖：

- 屏幕坐标；
- 固定 DOM 位置；
- “找到某按钮然后点击”；
- 模拟鼠标脚本。

这些方式脆弱，UI 一改就失效。

Skill 应暴露语义能力，例如：

```text
list_materials
list_templates
create_production_task
start_task
pause_task
resume_task
skip_task
retry_task
get_task_status
get_gpt_state
send_prompt
confirm_plan
download_result
package_work
archive_material
switch_account
```

AI 发出“生产 5 条转化内容”，底层自己决定如何调用网页、上传附件、检测状态和落盘。

---

## 四、统一 Core API

团建中控需要逐步提供稳定的本地 API 或 RPC。

### 4.1 系统

- `get_system_status`
- `get_health`
- `get_version`
- `get_recent_errors`
- `get_logs`

### 4.2 素材

- `list_materials`
- `get_material`
- `search_materials`
- `get_material_usage`
- `reserve_material`
- `release_material`

### 4.3 模板

- `list_templates`
- `get_template`
- `get_template_session`
- `bind_template_session`
- `initialize_template_session`

### 4.4 生产任务

- `create_task`
- `start_task`
- `pause_task`
- `resume_task`
- `safe_stop_task`
- `force_stop_task`
- `skip_task`
- `retry_task`
- `get_task_status`
- `list_active_tasks`

### 4.5 GPT 页面状态

- `get_account_status`
- `get_session_status`
- `get_current_stage`
- `get_upload_progress`
- `get_plan_state`
- `get_expected_image_count`
- `get_generated_image_count`
- `get_copy_status`
- `get_page_signals`

### 4.6 成品

- `list_outputs`
- `get_output`
- `validate_output`
- `package_output`
- `archive_material_after_success`
- `move_to_distribution_stage`

所有 UI 操作和自动工作流都逐步改为调用这些服务，而不是直接互相调用页面脚本。

---

## 五、Skill / MCP 层

Core API 是软件能力，Skill/MCP 是给 AI 的语义适配层。

AI 不需要知道几十个内部步骤。

### `produce_content`

输入可包括：

- 内容类型；
- 模板或模板类型；
- 数量；
- 素材范围；
- 账号；
- 是否允许自动续跑。

AI 可以说：

> 用转化模板生产 5 条团建内容，优先未使用素材。

Skill 内部完成：

```text
查素材
→ 按使用次数排序
→ 创建任务
→ 绑定模板会话
→ 启动生产
→ 监控结果
```

### `diagnose_production`

AI 可以说：

> 看一下团建中控为什么停了。

Skill 自动检查：

1. 软件服务；
2. GPT 页面；
3. 登录状态；
4. 当前账号；
5. 当前任务；
6. 当前阶段；
7. 附件状态；
8. 输入框残留；
9. 页面是否仍在生成；
10. 图片数量；
11. 限额/低产出；
12. 网络异常；
13. 本地成品；
14. 数据库和文件状态是否一致。

输出必须是可解释诊断，而不是只返回错误码。

---

## 六、可观察性是 AI 控制的前提

AI 不仅要能“做”，还必须能“看”。

每个自动任务都应提供结构化快照：

```text
任务 ID
素材
模板
账号
会话
当前阶段
阶段开始时间
附件总数/完成数
计划页数
本批预期图数
已生成图数
文案状态
打包状态
最近页面证据
最近错误
下一动作
nextProbeAt
```

异常时应尽量提供当前网页截图或关键 DOM 摘要给诊断层。

---

## 七、权限分层

AI 获得真实操作权后必须区分权限。

### Read

默认允许：

- 查看状态；
- 查任务；
- 查素材；
- 查模板；
- 查日志；
- 查错误；
- 诊断。

### Safe Write

允许自动执行：

- 创建生产任务；
- 开始；
- 暂停；
- 继续；
- 发送提示词；
- 触发安全重试；
- 加入分发队列。

### Destructive

建议需要明确确认或额外权限：

- 删除素材；
- 删除成品；
- 清空队列；
- 覆盖模板；
- 强制移动大量文件；
- 重置数据库；
- 清除账号登录数据。

任何 Skill 均不得暴露密码、Token、Cookie、验证码或恢复密钥。

---

## 八、AI 对话式使用示例

### 示例 1：生产库存

用户：

> 今天库存不够，生产 10 条团建转化内容，优先没用过的素材。

AI：

```text
查询素材
→ 选择 usage_count 最低的 10 条
→ 匹配转化模板
→ 创建任务队列
→ 启动中控
→ 监控任务
```

完成后返回：

- 成功数量；
- 暂停数量；
- 失败原因；
- 成品路径；
- 下一步建议。

### 示例 2：诊断

用户：

> 为什么账号 2 不动了？

AI 可返回：

```text
账号 2 当前阶段：LOW_OUTPUT
计划预期：8 张
实际检测：3 张
GPT 回复已停止
下次探测：17:52
处理：任务保留检查点，不重复上传素材。
```

### 示例 3：自然语言组合工作流

用户：

> 今天只跑 3 个账号，优先转化模板，做到晚上 11 点，任何账号触顶就切下一个。

AI 将自然语言转换为工作流配置，而不是开发一个新的“模式 7”。

---

## 九、和模块化工作流的关系

AI 原生设计的价值之一，是减少固定模式爆炸。

只要底层模块足够标准：

```text
选择素材
→ 选择模板
→ 上传
→ 等计划
→ 确认
→ 等图片
→ 出文案
→ 下载
→ 打包
→ 归档
```

AI 就可以根据用户要求临时组合模块。

因此：

- 常用流程保存为预设模式；
- 临时流程由 AI 动态组合；
- 所有流程仍受同一状态机、权限、安全和检查点约束。

---

## 十、实现顺序

### 阶段 1：内部服务化

- 将 UI 直接调用的关键业务函数逐步抽成统一 service；
- 保持现有 UI 和自动模式不变；
- 为任务、素材、模板、账号提供结构化查询。

### 阶段 2：本地 Core API

- 先开放只读状态；
- 再开放安全写操作；
- 增加事件流和任务订阅；
- 建立权限和审计日志。

### 阶段 3：团建中控 Skill

第一版至少提供：

- 查询状态；
- 查询素材；
- 创建任务；
- 开始/暂停/继续；
- 查询结果；
- 诊断异常。

### 阶段 4：软件内置 AI 助手

- 助手直接调用 Core API；
- 自动带入当前页面上下文；
- 支持自然语言控制；
- 支持解释、诊断和建议；
- 高风险动作保留确认。

### 阶段 5：跨 AI 适配

保证协议稳定后，让不同 AI 都能调用，而不是为每家模型重新写一套软件逻辑。

---

## 十一、验收清单

- [ ] UI、自动工作流和 AI 调用同一业务 service；
- [ ] 所有重要状态都有结构化读取接口；
- [ ] AI 可以知道当前任务卡在哪一步；
- [ ] AI 能创建、开始、暂停和恢复任务；
- [ ] AI 不依赖固定屏幕坐标完成核心动作；
- [ ] 外部 AI 和内置助手调用同一 Core API；
- [ ] 删除、覆盖、清库等高风险动作有权限保护；
- [ ] 每次 AI 操作有审计记录；
- [ ] AI 断开不会破坏当前任务检查点；
- [ ] 新增 AI 接入不需要复制业务代码。

## 十二、长期产品定义

团建中控的终局不是“一个自动点 GPT 的软件”。

它应该成为：

> 一个有标准能力接口、状态可观察、任务可恢复、既能人工直接操作，也能被各种 AI 自然语言控制的内容生产操作系统。
