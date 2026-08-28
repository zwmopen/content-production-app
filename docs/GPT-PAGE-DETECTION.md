# GPT 网页 DOM 检测规则

**版本：V1.0**
**关联文档：CONTENT-PRODUCTION-DESIGN.md**

## 一、检测原则

状态检测不能只依赖单个关键词或单一 DOM 元素。必须使用多信号综合判断。

### 核心信号源
1. 发送按钮状态（图标+可用性）
2. 消息流变化（DOM增量+文本稳定性）
3. 附件卡片状态
4. 图片节点与文件卡片
5. 文本内容特征匹配

## 二、发送按钮检测

```javascript
// 发送按钮状态判定
const sendButton = document.querySelector('button[data-testid="send-button"]');
const stopButton = document.querySelector('button[data-testid="stop-button"]');

// 四种状态
// 1. stopButton 可见 → GPT 仍在生成
// 2. sendButton 可用 → 可以提交
// 3. sendButton 禁用 → 附件或文本未就绪
// 4. 均不可见 → 页面异常
```

**约束：发送按钮只能作为辅助信号，不能单独决定状态。**

## 三、消息流检测

### 稳定性判定条件
```
消息内容连续稳定 N 秒（默认 N=8）
+ GPT 停止生成（stopButton 消失）
+ 页面没有新增 DOM 节点
= 可以进入下一状态
```

### 检测方法
```javascript
function isMessageStable(durationMs = 8000) {
    let lastHash = '';
    let stableSince = 0;
    const interval = 1000; // 每秒检查一次
    return new Promise((resolve) => {
        const timer = setInterval(() => {
            const latestMsg = getLatestAssistantMessage();
            const currentHash = hashText(latestMsg?.textContent || '');
            const now = Date.now();
            if (currentHash === lastHash) {
                if (stableSince === 0) stableSince = now;
                if (now - stableSince >= durationMs) {
                    clearInterval(timer);
                    resolve(true);
                }
            } else {
                stableSince = 0;
            }
            lastHash = currentHash;
        }, interval);
    });
}
```

## 四、附件上传检测

### 必须确认的条件
1. 原生附件卡片已出现（`[data-testid="attachment"]` 或文件预览容器）
2. 附件卡片数量 = 任务素材数量
3. 每个附件不再显示上传中状态（无 spinner / progress bar）
4. TXT 附件已出现
5. 发送按钮已可用
6. 输入框中提示词完整

```javascript
function checkAttachmentsReady(expectedCount) {
    const cards = document.querySelectorAll('[data-testid="attachment"], .attachment-card, [class*="attachment"]');
    if (cards.length < expectedCount) return false;
    const uploading = document.querySelectorAll('[class*="upload"][class*="progress"], [class*="spinner"]');
    if (uploading.length > 0) return false;
    const sendBtn = document.querySelector('button[data-testid="send-button"]');
    if (!sendBtn || sendBtn.disabled) return false;
    return true;
}
```

## 五、出图计划检测

### 识别关键词
```
"出图计划" | "逐页计划" | "页面规划" | "设计规划"
"P1" | "P2" | "P3" (页码标记)
"封面" | "内页" | "封底"
"共" + 数字 + "页"
"先生成" + 数字 + "张"
```

### 页数解析优先级
```
1. 识别 P1...Pn 标记 → 取最大编号
2. 识别明确页码标题（"第1页"..."第N页"）
3. 识别 "共X页" → X = 总计划页数
4. 识别 "先生成前10张" → 本批 = 10
5. 无法识别 → 默认本批上限10张，标记为"待核对"
```

### 关键规则：总计划 vs 本批预期
```
总计划 = 12 页（GPT 计划的完整作品页数）
本批预期 = 10 页（GPT 本批明确只生成 P1-P10）

正确行为：本批预期 = 10，不要求 12
错误行为：将总计划 12 当作本批预期，导致 10/10 被误判残缺

此规则必须保留，不可回退。
```

## 六、图片生成检测

### 检测目标
1. 最新助手回复中的图片节点
2. 图片文件卡片（可下载）
3. 完整文件组（GPT 可能折叠）
4. 下载链接
5. 图片尺寸

### 关键注意
```
GPT 可能把完整结果折叠在文件组中。
不能只统计页面可见的三张缩略图。
必须读取最新回复的外层容器和全部可下载文件。
```

### 图片完成条件
```
图片数量 = 本批预期数量
+ GPT 已停止生成
+ 最新回复稳定
+ 无新增图片节点
```

## 七、文案检测

### 完成条件
```
1. 最新回复属于当前文案请求
2. 没有继续生成
3. 文本长度 ≥ 最低有效字符数（默认 300）
4. 推荐有效字符 ≥ 600
5. 包含正文（不只是开场废话）
6. 满足当前小红书文案规则
7. 文本稳定若干秒
```

## 八、错误与降级检测

### 需要检测的错误模式

| 错误类型 | 检测特征 | 处理 |
|---------|---------|------|
| 网络错误 | "network error", "Something went wrong", 重试按钮 | NETWORK_RETRY |
| 限额提示 | "You've reached...", rate limit 文案 | QUOTA_PAUSED |
| 验证码 | CAPTCHA / 人机验证元素 | HUMAN_REQUIRED |
| 图片生成失败 | "Something went wrong while generating your image" | 重试1次→人工 |
| 内容安全拦截 | "content policy", "safety" | HUMAN_REQUIRED |
| Python代码 | ```python 标记 | DEGRADED_OUTPUT |
| 脚本拼图 | script 标签, 拼接特征 | DEGRADED_OUTPUT |
| 仅教程无图 | 解释文字多但无图片节点 | DEGRADED_OUTPUT |
| 低图数 | 图片1-3张 + 已停止 + 计划>3 | LOW_OUTPUT |

### 降级处理规则
```
发现脚本/Python/拼接降级时：
1. 停止当前任务
2. 不将结果当作成品
3. 不增加使用次数
4. 记录页面证据（截图+DOM快照）
5. 转入 HUMAN_REQUIRED 或重试队列
```

## 九、会话状态快照

```javascript
const sessionSnapshot = {
    taskId: "task_xxx",
    currentPhase: "WAITING_IMAGES",
    accountWindowId: "window_1",
    sessionUrl: "https://chatgpt.com/c/xxx",
    templateId: "tpl_001",
    detectedPlan: { total: 12, batchExpected: 10, parsed: true },
    detectedImages: 7,
    expectedImages: 10,
    confirmSentAt: "2026-08-03T10:30:00Z",
    imageGenerationDetectedAt: "2026-08-03T10:31:00Z",
    isGenerating: true,
    lastEvidence: "7/10 images detected, stop button visible",
    nextAction: "wait 10s then recheck",
    nextProbeAt: null
};
```
