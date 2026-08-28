# 生产状态机定义

**版本：V1.0**
**关联文档：CONTENT-PRODUCTION-DESIGN.md**

## 一、主状态枚举

```
IDLE                 → 待处理
MATERIAL_SELECTED    → 已选择素材
SESSION_PREPARING    → 准备模板会话
UPLOADING            → 正在上传附件
ATTACHMENTS_READY    → 附件上传完成
PROMPT_READY         → 提示词已填写
SENDING              → 正在发送
WAITING_PLAN         → 等待出图计划
PLAN_READY           → 出图计划已稳定
CONFIRMING           → 发送确认指令
WAITING_IMAGES       → 等待生成图片
IMAGES_READY         → 本批图片已完成
REQUESTING_COPY      → 发送文案提示词
WAITING_COPY         → 等待小红书文案
COPY_READY           → 文案已完成
SAVING_COPY          → 保存TXT
DOWNLOADING          → 下载图片
PACKAGING            → 整理工作包
VALIDATING           → 校验成品
ARCHIVING            → 更新使用次数并移动素材
COMPLETED            → 任务完成
```

## 二、异常状态枚举

```
NETWORK_RETRY        → 网络异常，等待重试
PAGE_RECOVERY        → 页面状态恢复中
QUOTA_PAUSED         → 账号触发限额
LOW_OUTPUT           → 图片数量过少
DEGRADED_OUTPUT      → 出现脚本、Python、拼接等降级结果
HUMAN_REQUIRED       → 需要人工判断
FAILED               → 任务失败
SKIPPED              → 任务已跳过
```

## 三、状态流转条件

### 3.1 主流程

| 当前状态 | 进入条件 | 退出到 | 退出条件 |
|---------|---------|-------|---------|
| IDLE | 任务创建 | MATERIAL_SELECTED | 素材文件夹被选中且占用锁获取成功 |
| MATERIAL_SELECTED | 素材选择完成 | SESSION_PREPARING | 模板会话已确定 |
| SESSION_PREPARING | 模板会话已绑定 | UPLOADING | 会话可用且输入框已清理 |
| UPLOADING | 开始上传附件 | ATTACHMENTS_READY | 附件卡片数量=任务素材数量且无上传中状态 |
| ATTACHMENTS_READY | 全部附件就绪 | PROMPT_READY | 提示词已填入输入框 |
| PROMPT_READY | 提示词填写完成 | SENDING | 发送按钮可用且准备点击 |
| SENDING | 点击发送 | WAITING_PLAN | 消息已发出，等待助手回复 |
| WAITING_PLAN | 等待GPT回复计划 | PLAN_READY | 计划文本稳定且可解析页数 |
| PLAN_READY | 计划解析完成 | CONFIRMING | 确认指令尚未发送（检查点验证） |
| CONFIRMING | 发送确认指令 | WAITING_IMAGES | 确认指令已发送且记录 confirm_sent_at |
| WAITING_IMAGES | 等待图片生成 | IMAGES_READY | 图片数量=本批预期且GPT已停止生成 |
| IMAGES_READY | 图片检测通过 | REQUESTING_COPY | 图片已完整且无降级 |
| REQUESTING_COPY | 发送文案提示词 | WAITING_COPY | 文案请求已发出 |
| WAITING_COPY | 等待文案生成 | COPY_READY | 文案文本稳定且长度达标 |
| COPY_READY | 文案检测通过 | SAVING_COPY | 文案内容已确认 |
| SAVING_COPY | 开始保存TXT | DOWNLOADING | TXT文件已写入且非空 |
| DOWNLOADING | 开始下载图片 | PACKAGING | 全部图片已下载到临时目录 |
| PACKAGING | 开始整理工作包 | VALIDATING | 成品文件夹已创建且文件已移入 |
| VALIDATING | 开始校验 | ARCHIVING | 校验全部通过 |
| ARCHIVING | 开始归档 | COMPLETED | 使用次数已更新且素材已移动 |

### 3.2 异常流转

| 当前状态 | 进入条件 | 恢复路径 |
|---------|---------|---------|
| NETWORK_RETRY | 检测到网络错误 | 退避重试（2min→5min→10min，最多3次）后回到断点状态 |
| PAGE_RECOVERY | 页面不确定 | 每10min重新检查，最多2次；仍无法判断转 HUMAN_REQUIRED |
| QUOTA_PAUSED | 检测到真实限额或低图数 | 等待额度恢复时间到达后回到 WAITING_IMAGES |
| LOW_OUTPUT | 图片1-3张且已停止生成 | 进入额度恢复等待，到点后探测1次 |
| DEGRADED_OUTPUT | 检测到脚本/Python/拼接 | 不当作成品，转 HUMAN_REQUIRED 或重试队列 |
| HUMAN_REQUIRED | 无法自动判断 | 等待人工操作后恢复 |
| FAILED | 不可恢复的错误 | 保留现场，记录错误 |
| SKIPPED | 用户跳过或重试超限 | 释放占用锁，不增加使用次数 |

## 四、关键约束

### 4.1 确认指令只发一次
```
if (checkpoint.confirm_sent_at != null) {
    // 跳过 CONFIRMING 状态，直接进入 WAITING_IMAGES
    state = WAITING_IMAGES;
}
```

### 4.2 附件未完成禁止发送
```
if (state != ATTACHMENTS_READY) {
    // 禁止进入 SENDING
    return;
}
```

### 4.3 文案是下载打包的硬前置
```
if (state != COPY_READY) {
    // 禁止进入 DOWNLOADING
    return;
}
```

### 4.4 校验通过才能归档
```
if (validationResult.failed.length > 0) {
    state = HUMAN_REQUIRED;
    return;
}
```

## 五、检查点写入时机

每个主状态进入时立即写检查点：

| 状态 | 检查点新增字段 |
|------|-------------|
| MATERIAL_SELECTED | taskId, materialPath, materialHash |
| SESSION_PREPARING | templateId, sessionUrl, accountWindowId |
| ATTACHMENTS_READY | attachmentCount |
| SENDING | promptHash |
| PLAN_READY | planText, totalPlannedPages, batchExpectedPages |
| CONFIRMING | confirm_sent_at |
| IMAGES_READY | detectedImageCount, firstImageReadyAt, lastImageReadyAt |
| COPY_READY | copyText, txtTempPath |
| DOWNLOADING | imageDownloadDir |
| PACKAGING | outputDir |
| ARCHIVING | usageUpdated |
| QUOTA_PAUSED | quota_detected_at, next_probe_at |

## 六、状态恢复流程

```
软件重启/断网恢复/浏览器恢复后：
1. 读取本地检查点文件
2. 检查真实GPT页面状态
3. 对比本地记录与页面状态
4. 确定当前真实状态
5. 从下一个安全动作继续

禁止行为：
- 从头重跑
- 重复发送提示词
- 重复发送确认指令
- 在输入框有残留时继续上传
```
