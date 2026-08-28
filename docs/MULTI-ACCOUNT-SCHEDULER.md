# 多账号调度与隔离规则

**版本：V1.0**
**关联文档：CONTENT-PRODUCTION-DESIGN.md**

## 一、基本架构

每个账号窗口是独立生产单元，拥有独立的：

| 独立资源 | 说明 |
|---------|------|
| 登录分区 | 各账号独立登录，不共享Cookie/Session |
| 当前模板 | 可绑定不同模板对话 |
| 当前会话 | 各自的 GPT 对话地址 |
| 当前任务 | 一次只处理一个帖子 |
| 任务队列 | 独立队列，互不干扰 |
| 状态机 | 独立状态流转 |
| 限额时间 | 独立计算恢复时间 |
| 检查点 | 独立保存和恢复 |
| 重试次数 | 独立计数 |
| 错误状态 | 独立记录 |

## 二、基本规则

### 2.1 一账号一任务
```
每个账号一次只能领取一个帖子
当前帖子完成打包后，该账号才能领取下一帖
```

### 2.2 素材隔离
```
禁止把账号A的素材注入账号B
账号A领取的素材，标记 occupiedBy = accountA
其他账号不能选择已被占用的素材
```

### 2.3 查看与操作分离
```
用户切换可见窗口只影响查看，不影响任务绑定
正在运行的任务仍留在原账号窗口
后续动作不会误发到当前可见窗口
```

### 2.4 共享素材锁
```
所有账号共享素材占用锁
占用锁字段：material_id, occupied_by, occupied_at, task_id
释放条件：任务完成/失败/跳过
```

## 三、任务绑定

每个生产任务必须绑定四个ID：
```
任务ID + 账号窗口ID + GPT会话ID + 模板ID
```

```json
{
    "taskId": "task_20260803_001",
    "accountWindowId": "window_chrome_1",
    "gptSessionId": "https://chatgpt.com/c/abc123",
    "templateId": "tpl_teambuilding_v3"
}
```

## 四、调度方式

### 可选策略
| 策略 | 说明 |
|------|------|
| 轮询 | 按固定顺序依次分配任务 |
| 空闲优先 | 优先分配给空闲最久的账号 |
| 额度可用优先 | 优先分配给未触顶的账号 |
| 固定账号顺序 | 按预设顺序分配 |
| 模板绑定账号 | 账号与模板一一对应 |

### 第一版推荐
```
空闲账号优先 + 固定模板绑定
```

### 调度逻辑
```javascript
function selectAccountForTask(task, accounts) {
    // 1. 过滤出空闲且未触顶的账号
    const available = accounts.filter(a => 
        a.status === 'idle' && 
        !a.quotaPaused &&
        a.templateId === task.templateId
    );
    if (available.length === 0) return null;
    
    // 2. 按空闲时间排序，选最久空闲的
    available.sort((a, b) => a.idleSince - b.idleSince);
    return available[0];
}
```

## 五、账号状态模型

```javascript
const accountState = {
    id: "window_chrome_1",
    name: "账号A",
    status: "idle",         // idle | busy | quota_paused | error | offline
    currentTaskId: null,
    templateId: "tpl_v3",
    sessionId: "https://chatgpt.com/c/abc123",
    quotaDetectedAt: null,
    nextProbeAt: null,
    idleSince: Date.now(),
    errorCount: 0,
    retryCount: 0,
    checkpoint: null
};
```

### 状态流转
```
idle → busy (领取任务)
busy → idle (任务完成)
busy → quota_paused (触顶)
quota_paused → busy (恢复时间到达)
busy → error (异常)
error → idle (人工恢复)
```

## 六、触顶隔离

```
账号A触顶：
1. 只暂停账号A，标记 quota_paused
2. 计算 next_probe_at = image_generation_detected_at + 3h
3. 账号B、C 不受影响，继续运行
4. 到达 next_probe_at 后，账号A 探测一次
5. 探测成功 → 恢复 busy
6. 探测失败 → 继续等待，转人工检查
```

## 七、素材数据库与占用锁

### 素材表
```sql
CREATE TABLE materials (
    material_id TEXT PRIMARY KEY,
    folder_hash TEXT UNIQUE NOT NULL,
    folder_name TEXT NOT NULL,
    current_path TEXT NOT NULL,
    usage_count INTEGER DEFAULT 0,
    content_type TEXT,
    tags TEXT,
    last_used_at TEXT,
    last_task_id TEXT,
    status TEXT DEFAULT 'available',  -- available | occupied | used
    occupied_by TEXT,                 -- account_id
    occupied_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
```

### 占用锁操作
```javascript
// 领取素材
function acquireMaterial(materialId, accountId) {
    const result = db.execute(
        `UPDATE materials SET status='occupied', occupied_by=?, occupied_at=datetime('now') 
         WHERE material_id=? AND status='available'`,
        [accountId, materialId]
    );
    return result.changes > 0;
}

// 释放素材
function releaseMaterial(materialId) {
    db.execute(
        `UPDATE materials SET status='available', occupied_by=NULL, occupied_at=NULL 
         WHERE material_id=?`,
        [materialId]
    );
}

// 完成后更新使用次数
function completeMaterial(materialId, taskId) {
    db.execute(
        `UPDATE materials SET 
            usage_count = usage_count + 1,
            status = 'used',
            last_used_at = datetime('now'),
            last_task_id = ?,
            occupied_by = NULL,
            occupied_at = NULL,
            updated_at = datetime('now')
         WHERE material_id=?`,
        [taskId, materialId]
    );
}
```

## 八、自动选择优先级

```
1. 用户手动选择队列（最高优先）
2. 未使用素材 (usage_count = 0)
3. 已使用1次 (usage_count = 1)
4. 已使用2次 (usage_count = 2)
5. 已使用3次 (usage_count = 3)

同使用次数内：
按 last_used_at 升序（最久未用的先选）
或按文件夹名称排序
或随机选择
```
