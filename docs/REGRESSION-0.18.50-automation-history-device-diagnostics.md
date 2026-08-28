# 0.18.50 自动库存记录回归

- `inventory_unknown` 记录标题包含具体设备身份、分类和“自动分发未执行”。
- 记录来源显示“自动库存检查（后台轮询）”。
- 展开详情显示设备备注/名称/型号/标识、未执行原因和升级重连建议。
- 有当前设备快照时，历史日志通过 `deviceId` 解析到电脑端备注与手机型号。
- 自动图标为循环符号，手动图标为发送符号，均有 `aria-label` 与悬停说明。
- 设备发现、首次确认、传输目标解析与登录状态不受影响。

## 验证命令

```powershell
node --check public/distribution-ui.js
node --check server.js
node --test --test-concurrency=1 public/distribution-ui.test.js public/workbench-ui.test.js server/routes/distribution.test.js
git diff --check
```

## 结果

本批目标测试 261 项通过；未执行真实设备传输，避免影响当前设备连接与生产状态。
