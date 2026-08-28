# 0.18.48 设备名称与身份同步交接

## 本次目标

文件传输页的设备名称必须可编辑、可持久化，并且不能因为手机重新连接或手机型号/名称变化而覆盖电脑端备注。

## 已完成

- 设备行改为一行电脑端名称，第二行只显示“手机储备 N 个”或“手机储备未上报”。在线、离线、自动分发等状态继续在状态标签中显示。
- `note` 是电脑端显示备注，`syncedName` / `syncedModel` 保留手机同步身份；电脑端备注优先显示。
- 已登记设备和自动发现设备都能点击名称编辑，保存到运行数据 `device-notes.json`。
- 传输请求继续使用 `liveName`、型号或别名解析真实手机，不会把电脑备注误当成传输目标。

## 验收

- `node --check public/app.js`
- `node --check server.js`
- `node --test --test-concurrency=1 public/distribution-ui.test.js public/workbench-ui.test.js`

本批测试 259 项通过。真实手机传输仍需在设备在线时做一次端到端验证；本次未改动传输协议和登录数据。
