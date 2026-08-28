# 限额恢复与重试策略

**版本：V1.0**
**关联文档：CONTENT-PRODUCTION-DESIGN.md**

## 一、核心原则

### 不硬编码官方额度
不要把 "每3小时50张" 当作绝对规则写死。系统应记录实际页面信号和真实时间。

### 关键时间字段
```json
{
    "confirm_sent_at": "发送确认指令1的时间",
    "image_generation_detected_at": "首次检测到图片开始生成的时间",
    "first_image_ready_at": "第一张图完成时间",
    "last_image_ready_at": "最后一张图完成时间",
    "quota_detected_at": "检测到真实限额的时间",
    "next_probe_at": "下次允许探测时间"
}
```

## 二、额度周期计算

### 优先方案
```
next_probe_at = image_generation_detected_at + 3小时
```

### 退化方案
```
如果无法检测到图片开始生成时间：
next_probe_at = confirm_sent_at + 3小时
```

### 不使用
```
不使用 "图片完成时间往前推15分钟" 作为主规则
因为可以直接记录真实开始时间
```

## 三、低图数判定

### 必须同时满足
```
1. 计划预期图片数 > 3
2. GPT 已经停止生成
3. 最新回复稳定（连续N秒无变化）
4. 实际可下载图片数量 = 1 ~ 3
5. 没有继续生成迹象
```

### 判定后处理
```
1. 标记 LOW_OUTPUT
2. 保存已生成图片作为诊断证据
3. 不打包正式成品
4. 不增加使用次数
5. 暂停当前账号
6. 按 image_generation_detected_at + 3小时 计算下次探测时间
```

## 四、网络异常处理

### 退避策略
```
第1次重试：等待 2 分钟
第2次重试：等待 5 分钟
第3次重试：等待 10 分钟
最多 3 次
```

### 每次重试前检查
```
1. 页面是否恢复
2. 当前任务阶段
3. 是否已经发送成功
4. 是否已经出现计划或图片
```

### 禁止行为
```
- 盲目重新上传
- 在网络异常时继续发送提示词
- 将网络错误与额度触顶混为一类
```

## 五、页面检测不确定

### 处理策略
```
每 10 分钟重新检查一次
最多检查 2 次
仍然无法判断 → 转 HUMAN_REQUIRED
```

## 六、额度恢复后的重试

### 恢复条件
```
当前时间 ≥ next_probe_at
```

### 重试请求文案
```
请重新批量生成刚才这套图片。刚才生成数量不足或发生错误，请严格按照已经确认的出图计划完整生成本批作品，不要解释，不要输出脚本或Python代码。
```

### 恢复后仍只有1-3张
```
1. 再确认一次页面没有继续生成
2. 标记当前任务需要人工检查
3. 不无限重复
4. 可跳过该素材
5. 继续下一条素材或停止当前账号
```

## 七、重试模块配置

### 工作流中的重试设置
```json
{
    "action": "send-confirm",
    "retryEnabled": true,
    "retryDelayMin": 120,
    "retryDelayMax": 300
}
```

### 适用模块
- `upload-material`（上传素材后检测失败）
- `send-text`（发送文字后检测失败）
- `send-confirm`（发送确认后检测失败）
- `request-copy`（请求文案后检测失败）

### 重试规则
```
1. 发送后等待 6 秒做初步检测
2. 检测到失败特征（"Something went wrong" 等）后等待 retryDelayMin ~ retryDelayMax 秒
3. 重新发送原始提示词
4. 标记 retryExecuted = true
5. 再次检测：成功则继续；失败则转人工
6. 单个提示词最多重试 1 次
```

## 八、出图失败重试检测

### 检测特征
```javascript
const TRANSIENT_ERROR_PATTERNS = [
    /something\s+went\s+wrong/i,
    /sorry\s+about\s+that/i,
    /network\s*(?:error|issue)/i,
    /connection\s*(?:error|timeout|reset)/i,
    /please\s+try\s+again/i
];
```

### 执行流程
```
1. 发送确认指令1
2. 等待6秒
3. 读取最新助手消息
4. 匹配 TRANSIENT_ERROR_PATTERNS
5. 如果匹配且未重试过：
   a. 随机等待 retryDelayMin ~ retryDelayMax 秒
   b. 重新发送 "1"
   c. 标记 confirmRetried = true
   d. 保存检查点
6. 如果匹配且已重试过：转人工
7. 如果不匹配：继续等待图片
```

## 九、账号隔离规则

### 多账号场景
```
账号A触顶 → 只暂停账号A
账号B、C 继续运行
账号A 的额度恢复时间独立计算
不影响其他账号的 next_probe_at
```

### 素材占用锁
```
所有账号共享素材占用锁
账号A领取素材X后，账号B不能领取同一素材
避免多账号同时处理同一帖子
```
