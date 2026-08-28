# 0.18.49 设备状态标签收敛交接

## 变更

文件传输设备卡不再为每台设备常驻显示“可自动分发”和“可发送”。连接方式仍显示 Wi-Fi、USB、远程的真实状态；设备卡本身继续用在线/离线样式区分状态。

首次自动分发确认没有删除：只有尚未确认且当前在线的设备才显示“允许自动分发”按钮，并通过按钮说明确认原因。

## 影响边界

- 未改变自动分发审批、设备发现、传输目标解析和库存逻辑。
- 未修改设备备注、手机同步名称/型号或登录数据。
- 仅调整设备卡的状态信息密度。

## 验证

`public/workbench-ui.test.js`、`public/distribution-ui.test.js` 与 `server/routes/distribution.test.js` 共 260 项通过；`node --check public/app.js` 与 `git diff --check` 通过。
