# Junction Link 移除测试计划

> **版本**：0.14.56（计划）
> **日期**：2026-08-06
> **目标**：移除 `distribution-data.js` 中的遗留兼容 junction link 逻辑，确保删除后不影响现有文件分发流程。

---

## 一、移除范围与保留范围

### 需要移除的（遗留兼容 junction）

| 函数 | 位置 | 作用 |
|---|---|---|
| `replaceDirectoryLink` | distribution-data.js:319 | 创建/删除单个 junction 兼容入口 |
| `syncLegacyLinksForStage` | distribution-data.js:350 | 按 stage 批量同步 PLATFORM_DIRS 下的 junction |
| `removeMatchingLink` | distribution-data.js:307 | 移除匹配的 junction 入口 |
| `ensureWorkflowCompatibilityLinks` | distribution-data.js:421 | 分发前确保 mobile stage 的兼容入口 |

**调用方移除点**（在这些函数中删除 junction 相关调用，保留核心文件移动逻辑）：

| 调用方函数 | 需移除的调用 | 保留的核心逻辑 |
|---|---|---|
| `moveCollectionSourceToStage` | `removeMatchingLink` 循环 (L463-465)、`syncLegacyLinksForStage` (L469, L472) | `fs.renameSync` / `archiveAndRemoveCollection` / `appendWorkflowOperation` |
| `renameCollectionType` | junction unlink 循环 (L507-514)、`syncLegacyLinksForStage` (L516) | `fs.renameSync` / `appendWorkflowOperation` |
| `reconcileWorkflowFolders` | `syncLegacyLinksForStage` (L574, L610) | `archiveAndRemoveCollection` / `fs.renameSync` / 日志写入 |
| `markOfficialUsed` | 无直接调用（间接通过 `moveCollectionSourceToStage`） | CSV 日志写入 |
| `startDistributionTask` (server.js:4420) | `ensureWorkflowCompatibilityLinks` 调用 | 分发任务创建和执行 |

### 需要保留的（不能动）

| 函数 | 位置 | 原因 |
|---|---|---|
| `createDirectoryJunction` | server.js:3962 | 素材筛选整合功能使用，与分发兼容入口无关 |
| `inspectPlatformEntry` | distribution-data.js:203 | 快照读取仍需识别旧 junction（向后兼容） |
| `listDirectoryNames` | distribution-data.js:120 | 目录遍历仍需处理 symlink（通用安全） |
| `getDistributionSnapshot` | distribution-data.js:680 | 快照读取逻辑保留，仅不再有新 junction 被创建 |
| `PLATFORM_DIRS` 常量 | distribution-data.js:34 | 快照读取仍需遍历这些目录 |
| `isSymbolicLink()` 检查 | 多处 | 文件移动安全检查（防止移动链接）保留 |

### 需要清理的导出和测试

| 项目 | 文件 | 处理方式 |
|---|---|---|
| `replaceDirectoryLink` 导出 | distribution-data.js:882 | 移除导出 |
| `ensureWorkflowCompatibilityLinks` 导出 | distribution-data.js:873 | 移除导出 |
| `ensureWorkflowCompatibilityLinks` 引入 | server.js:22 | 移除引入 |
| `replace-directory-link.test.js` | lib/replace-directory-link.test.js | 整个文件删除 |
| test 脚本中的引用 | package.json:12 | 移除 `lib/replace-directory-link.test.js` |
| `distribution-data.test.js` | lib/distribution-data.test.js | 已废弃（全部 skip），检查并清理 junction 相关测试代码 |

---

## 二、测试环境准备

### 2.1 目录结构

```
临时测试根目录（%TEMP%\junction-removal-test\）
├── 发布空间\
│   ├── 小红书\
│   ├── 抖音\
│   ├── 公众号\
│   ├── 已使用\
│   └── 归档\抖音\
├── 抖音小红书\          (workflow mobile stage)
│   ├── 作品集_001[泛]\
│   │   ├── 01\
│   │   │   ├── 1.jpg
│   │   │   └── 文案.txt
│   │   ├── 02\
│   │   └── 03\
│   ├── 作品集_002[转]\
│   └── 作品集_003[泛]\
├── 微信公众号\          (workflow official stage)
└── 已发送\              (workflow used stage)
```

### 2.2 CSV 日志文件

在发布空间下准备：
- `device-usage-log.csv`：1 条手机分发记录（作品集_001[泛]）
- `official-account-usage-log.csv`：1 条公众号待上传记录（作品集_002[转]）

### 2.3 旧 junction 模拟

在发布空间的小红书、抖音目录下手动创建指向 `抖音小红书\作品集_001[泛]` 的 junction（模拟移除前遗留的状态），用于验证移除后读取逻辑仍能正确识别。

---

## 三、单元测试

### 3.1 移除后需新增/修改的测试

#### T1: moveCollectionSourceToStage — 移动到 official 不创建 junction

```
前置：作品集_001[泛] 在 mobile stage，有真实文件夹和图片
操作：moveCollectionSourceToStage({ stage: "official" })
验证：
  ✓ 返回 { ok: true, stage: "official" }
  ✓ 真实文件夹已从 抖音小红书\ 移动到 微信公众号\
  ✓ 发布空间\小红书\ 下没有新建 junction
  ✓ 发布空间\抖音\ 下没有新建 junction
  ✓ 发布空间\公众号\ 下没有新建 junction
  ✓ operation-history.jsonl 有记录
```

#### T2: moveCollectionSourceToStage — 压缩归档到 used 不创建 junction

```
前置：作品集_002[转] 在 official stage，有真实文件夹和图片
操作：moveCollectionSourceToStage({ stage: "used" })
验证：
  ✓ 已发送\ 下生成 作品集_002[转].zip
  ✓ 真实文件夹已删除
  ✓ 发布空间\所有平台目录\ 下没有新建 junction
  ✓ operation-history.jsonl 有记录
```

#### T3: renameCollectionType — 重命名不创建 junction

```
前置：作品集_003[泛] 在 mobile stage
操作：renameCollectionType({ collection: "作品集_003[泛]", type: "conversion" })
验证：
  ✓ 抖音小红书\ 下文件夹名变为 作品集_003[转]
  ✓ 发布空间\所有平台目录\ 下没有新建 junction
  ✓ operation-history.jsonl 有记录
```

#### T4: reconcileWorkflowFolders — 整理不创建 junction

```
前置：workflow root 下有散落的 作品集_004[泛] 真实文件夹
操作：reconcileWorkflowFolders({ apply: true })
验证：
  ✓ 作品集_004[泛] 被移动到正确的 stage 文件夹
  ✓ 发布空间\所有平台目录\ 下没有新建 junction
  ✓ migration log 已写入
```

#### T5: getDistributionSnapshot — 仍能正确读取旧 junction

```
前置：发布空间\小红书\ 下有手动创建的旧 junction 指向 mobile stage 作品
操作：getDistributionSnapshot()
验证：
  ✓ 快照正常返回，不崩溃
  ✓ 旧 junction 被识别为 present + valid
  ✓ 作品集的 workflowStage 正确判断
  ✓ summary.douyinArchived 正确计数
```

#### T6: getDistributionSnapshot — 无 junction 时正常工作

```
前置：发布空间所有平台目录为空，作品仅在 workflow stage 文件夹
操作：getDistributionSnapshot()
验证：
  ✓ 快照正常返回
  ✓ 作品集从 workflow stage 文件夹中正确识别
  ✓ workflowStage 正确（mobile/official/used）
  ✓ automaticEligible 正确判断
```

#### T7: markOfficialUsed — 标记已使用不创建 junction

```
前置：作品集在 official stage，有 official-account-usage-log.csv 记录
操作：markOfficialUsed({ collection: "作品集_002[转]" })
验证：
  ✓ 作品集被移动到 used stage 并压缩
  ✓ CSV 日志追加正确
  ✓ 发布空间\所有平台目录\ 下没有新建 junction
```

### 3.2 移除后需删除的测试

| 测试文件 | 测试用例 | 原因 |
|---|---|---|
| replace-directory-link.test.js | 全部 5 个用例 | 被测函数已移除 |
| distribution-data.test.js | 已废弃（全部 skip），无需改动 | 已无实际执行 |

### 3.3 不受影响的测试（验证仍通过）

| 测试文件 | 关注点 |
|---|---|
| path-security.test.js | junction 相关测试在安全上下文中，不受影响 |
| dedup-ledger.test.js | CSV 日志中 "删除小红书+抖音 Junction" 文本仅是历史数据 |
| distribution-scan-validity.test.js | 扫描有效性测试 |
| workbench-ui.test.js | 前端 UI 测试 |

---

## 四、API 集成测试

### 4.1 分发任务创建

#### API-1: POST /api/distribution/tasks — 分发前不再创建 junction，分发成功后自动移动到 official

```
前置：作品集在 mobile stage，设备在线
请求：{ action: "device-restock", device: "1号", collection: "作品集_001[泛]", confirmed: true }

验证（分发前）：
  ✓ 返回 taskId，任务正常创建
  ✓ 不调用 ensureWorkflowCompatibilityLinks（移除后）
  ✓ 发布空间\平台目录\ 下无新 junction

验证（分发成功后，code === 0）：
  ✓ 自动调用 moveCollectionSourceToStage({ stage: "official" })
  ✓ 真实文件夹从 抖音小红书\ 移动到 微信公众号\
  ✓ moveCollectionSourceToStage 内部不再调用 syncLegacyLinksForStage（移除后）
  ✓ 发布空间\平台目录\ 下无新 junction
  ✓ record.message = "作品包已发送，已自动进入公众号"
```

#### API-2: POST /api/distribution/tasks — 不传 collection 时正常

```
请求：{ action: "device-restock", device: "1号", confirmed: true }
验证：
  ✓ 不调用 ensureWorkflowCompatibilityLinks（collection 为空跳过）
  ✓ 任务正常创建
```

### 4.2 作品集操作

#### API-3: POST /api/distribution/mark-used

```
前置：作品集在 official stage
请求：{ collection: "作品集_002[转]", confirmed: true }
验证：
  ✓ 作品移动到 used 并压缩
  ✓ CSV 日志追加
  ✓ 无 junction 创建
```

#### API-4: POST /api/distribution/classify

```
前置：作品集在 mobile stage
请求：{ collection: "作品集_003[泛]", type: "conversion", confirmed: true }
验证：
  ✓ 文件夹重命名成功
  ✓ 无 junction 创建
```

#### API-5: POST /api/distribution/reconcile-folders

```
前置：workflow root 有散落作品集
请求：{ confirmed: true }
验证：
  ✓ 作品集被正确归类到 stage 文件夹
  ✓ 无 junction 创建
  ✓ migration log 写入
```

### 4.3 快照与检查

#### API-6: POST /api/distribution/check

```
请求：{ inventory: true, force: true }
验证：
  ✓ 返回正常，不崩溃
  ✓ 设备状态正确
  ✓ inventory 正常输出
```

#### API-7: 前端分发页面加载快照

```
操作：打开工作台 → 切换到分发页面
验证：
  ✓ 作品集列表正常显示
  ✓ 各平台状态（available/used/invalid）正确
  ✓ summary 统计数字正确
  ✓ 旧 junction 仍被正确识别（如果有）
```

---

## 五、端到端流程测试

### E2E-1: 手机分发完整流程（分发成功后自动移动到公众号）

> **关键场景**：分发到设备成功后，代码在 `server.js:4483` 自动调用
> `moveCollectionSourceToStage({ stage: "official" })`，将作品集从抖音小红书
> 移动到微信公众号。junction link 在此流程中被触发两次：分发前
> `ensureWorkflowCompatibilityLinks`（server.js:4420）和分发成功后
> `moveCollectionSourceToStage` 内部的 `syncLegacyLinksForStage`（distribution-data.js:472）。

```
步骤：
1. 在 mobile stage（抖音小红书）创建作品集（含图片和文案）
2. 通过 UI 点击"分发到设备"
3. Python 脚本发送文件到手机，等待返回 code === 0
4. 确认自动移动逻辑被触发（moveCollectionSourceToStage stage: "official"）
5. 检查发布空间目录无 junction

验证：
  ✓ 分发成功（record.state = "completed"）
  ✓ record.message = "作品包已发送，已自动进入公众号"
  ✓ 真实文件夹已从 抖音小红书\ 移动到 微信公众号\
  ✓ 发布空间\小红书\ 下无新 junction（移除 ensureWorkflowCompatibilityLinks 后）
  ✓ 发布空间\抖音\ 下无新 junction（移除 syncLegacyLinksForStage 后）
  ✓ 发布空间\公众号\ 下无新 junction（移除 syncLegacyLinksForStage 后）
  ✓ device-usage-log.csv 记录正确
  ✓ operation-history.jsonl 有"移动到微信公众号"记录
  ✓ 快照状态正确（workflowStage = "official"）
```

### E2E-1b: 分发成功但自动移动失败（容错验证）

```
步骤：
1. 在 mobile stage 创建作品集
2. 通过 UI 分发到设备
3. 模拟 moveCollectionSourceToStage 抛出异常（如目标路径被占用）
4. 检查错误处理

验证：
  ✓ record.state = "completed"（分发本身成功）
  ✓ record.stageLabel = "发送完成，文件待整理"
  ✓ record.message 包含 "自动移动失败"
  ✓ 作品集仍留在 mobile stage（未移动）
  ✓ 不创建 junction
  ✓ 用户可手动通过"整理文件夹"功能修复
```

### E2E-2: 公众号标记已使用完整流程

```
步骤：
1. 作品集已在 official stage（微信公众号）
2. 通过 UI 点击"标记已使用"
3. 确认 moveCollectionSourceToStage({ stage: "used" }) 被调用
4. 检查作品集已归档到 used stage

验证：
  ✓ 每步操作无 junction 创建
  ✓ CSV 日志链完整
  ✓ operation-history.jsonl 记录正确
  ✓ 最终作品集在 已发送\ 下为 .zip
```

### E2E-3: 整理散落文件夹

```
步骤：
1. 在 workflow root 直接创建散落的作品集文件夹
2. 通过 UI 执行"整理文件夹"
3. 确认作品集被正确归类

验证：
  ✓ 散落文件夹被移动到正确的 stage
  ✓ 无 junction 创建
  ✓ migration log 写入
  ✓ 快照状态更新正确
```

### E2E-4: 重命名作品集分类

```
步骤：
1. 作品集在 mobile stage，名称为 作品集_001[泛]
2. 通过 UI 修改分类为"精准流量"
3. 确认文件夹名称变为 作品集_001[转]

验证：
  ✓ 文件夹重命名成功
  ✓ 无 junction 创建
  ✓ 快照中分类信息更新
  ✓ operation-history.jsonl 记录正确
```

---

## 六、回归测试

### 6.1 全量 npm test

```
命令：cd src && npm test
预期：262 pass / 0 fail / 4 skip（与移除前一致，减去 replace-directory-link.test.js 的 5 个用例）
注意：如果 replace-directory-link.test.js 从 package.json 移除后 pass 数减少 5，
      新增的 T1-T7 测试应补回对应数量。
```

### 6.2 素材筛选功能不受影响

```
操作：在工作台使用素材筛选整合功能
验证：
  ✓ createDirectoryJunction 仍正常工作
  ✓ 筛选整合文件夹正常创建
  ✓ junction 在素材筛选目录下正常创建（这是独立功能）
```

### 6.3 前端错误消息

```
操作：触发一个包含 "Junction" 或 "源目录" 或 "入口" 的错误
验证：
  ✓ app.js:6634 的错误消息映射仍正常工作
  ✓ 用户看到 "未找到可用作品文件夹" 而非原始错误
```

---

## 七、边界与异常测试

### EDGE-1: 发布空间有旧 junction — 移动作品集

```
前置：发布空间\小红书\ 下有旧 junction 指向 mobile stage 作品集_001
操作：moveCollectionSourceToStage({ collection: "作品集_001[泛]", stage: "official" })
验证：
  ✓ 旧 junction 不被删除（移除后不再清理）
  ✓ 旧 junction 不影响移动操作
  ✓ 真实文件夹正常移动
  ✓ 快照仍能识别旧 junction（但 sourcePath 指向已移动的新位置或标记 invalid）
```

### EDGE-2: 发布空间有旧 junction — 快照读取

```
前置：发布空间\小红书\ 和 \抖音\ 下有旧 junction 指向同一源
操作：getDistributionSnapshot()
验证：
  ✓ 快照正常返回
  ✓ sameDualTarget 判断正确
  ✓ douyinArchived 统计正确
```

### EDGE-3: 悬空 junction — 快照读取

```
前置：发布空间\小红书\ 下有 junction 指向已删除的目录
操作：getDistributionSnapshot()
验证：
  ✓ 快照不崩溃
  ✓ 该条目标记为 present: true, valid: false, reason: "Junction 已断开"
```

### EDGE-4: 真实文件夹占用兼容入口位置

```
前置：发布空间\小红书\作品集_001[泛]\ 是真实文件夹（非 junction）
操作：getDistributionSnapshot()
验证：
  ✓ 快照正常返回
  ✓ 该条目标记为 physical: true
  ✓ 不抛出异常
```

### EDGE-5: 多个 stage 有同名作品冲突

```
前置：mobile 和 official stage 同时有 作品集_001[泛] 真实文件夹
操作：getDistributionSnapshot()
验证：
  ✓ 快照正常返回
  ✓ exclusionReasons 包含"三个阶段文件夹存在同名作品冲突"
  ✓ automaticEligible = false
```

---

## 八、执行检查清单

### 移除前

- [ ] 备份当前 `distribution-data.js` 和 `server.js`
- [ ] 记录当前 `npm test` 结果作为基线（262 pass / 0 fail / 4 skip）
- [ ] 记录当前发布空间目录下的 junction 状态（`dir /AL /S 发布空间\`）
- [ ] 确认 `replace-directory-link.test.js` 的 5 个用例当前状态

### 移除中

- [ ] 删除 `replaceDirectoryLink` 函数
- [ ] 删除 `syncLegacyLinksForStage` 函数
- [ ] 删除 `removeMatchingLink` 函数
- [ ] 删除 `ensureWorkflowCompatibilityLinks` 函数
- [ ] 从 `moveCollectionSourceToStage` 中移除 junction 调用（保留 renameSync/archiveAndRemoveCollection）
- [ ] 从 `renameCollectionType` 中移除 junction 调用（保留 renameSync）
- [ ] 从 `reconcileWorkflowFolders` 中移除 junction 调用（保留 renameSync/archiveAndRemoveCollection）
- [ ] 从 `module.exports` 中移除 `replaceDirectoryLink` 和 `ensureWorkflowCompatibilityLinks`
- [ ] 从 `server.js` 中移除 `ensureWorkflowCompatibilityLinks` 引入和调用
- [ ] 删除 `replace-directory-link.test.js` 文件
- [ ] 从 `package.json` test 脚本中移除 `lib/replace-directory-link.test.js`
- [ ] 新增 T1-T7 测试用例

### 移除后

- [ ] 运行全量 `npm test`，确认 0 fail
- [ ] 手动执行 E2E-1 到 E2E-4
- [ ] 手动执行 EDGE-1 到 EDGE-5
- [ ] 确认素材筛选功能正常（6.2）
- [ ] 确认前端错误消息正常（6.3）
- [ ] 检查发布空间目录无新 junction 创建
- [ ] 更新 VERSION、index.html 缓存版本
- [ ] 更新 CHANGELOG.md 和 HANDOFF.md
- [ ] 更新 RECENT_CONTEXT.md

---

## 九、风险评估

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 旧 junction 遗留导致快照状态混乱 | 中 | `inspectPlatformEntry` 保留读取逻辑，旧 junction 仍被识别 |
| 手势软件依赖发布空间的 junction | 低 | 用户已确认手势软件直接操作，不再依赖 junction |
| `removeMatchingLink` 移除后旧 junction 不再被清理 | 低 | 旧 junction 不会被清理但也不影响新流程，快照会标记为 invalid |
| 测试 pass 数减少 | 低 | 从 package.json 移除 replace-directory-link.test.js，新增 T1-T7 补回 |
| `createDirectoryJunction` 被误删 | 高 | 明确标注为保留范围，仅在 `collectMaterialLinks` 中使用 |
| 前端引用 junction 相关错误消息 | 低 | app.js:6634 的错误映射保留，不影响用户体验 |

---

## 十、回滚方案

如果移除后发现关键流程受影响：

1. 从 Git 恢复 `distribution-data.js` 和 `server.js`
2. 恢复 `replace-directory-link.test.js` 和 `package.json`
3. 重启 Electron 应用
4. 手动清理移除期间可能创建的非预期文件状态

回滚判断标准：
- `npm test` 出现 fail
- E2E 流程中任意一步失败
- 快照生成崩溃或数据不正确
- 手机分发流程失败
