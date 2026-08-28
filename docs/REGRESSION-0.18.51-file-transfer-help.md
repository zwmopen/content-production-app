# 0.18.51 文件传输说明回归

- 帮助标题仍为“文件传输说明”，按钮仍显示“知道了”，不影响原有关闭行为。
- 说明包含首次使用、手动发送、自动分发、泛/精准、失败恢复、去重规则、操作记录、看不到设备和库存未上报等关键段落。
- 系统说明弹窗具备 `max-height` 与 `overflow-y: auto`，长说明可滚动阅读。
- 设备卡片、拖拽上传、自动库存检查、重试和操作记录渲染未改动。

## 验证命令

```powershell
node --check public/app.js
node --check public/workbench-ui.test.js
node --test --test-concurrency=1 public/workbench-ui.test.js
git diff --check
```

## 结果

`public/workbench-ui.test.js`：241 项通过；本次未执行真实设备发送，避免干扰当前连接与生产。

