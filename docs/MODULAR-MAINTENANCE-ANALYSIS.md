# 分模块维护分析（多窗口并行）

> 2026-08-06 分析，未动代码。目标：支持用户同时开多个窗口并行维护不同模块/不同软件，互不打架。

## 2026-08-08 实施状态

- 后端第一阶段已完成：`server.js` 从约 6,265 行降到约 5,412 行，8 个业务路由已落入 `src/server/routes/`。入口仍偏大，是因为共享依赖装配和兼容路由尚未继续收口。
- 前端开始迁移：`gpt-account-rotation.js`、`gpt-prompt-registry.js` 与 `gpt-runtime-recovery.js` 已独立加载；最新 `app.js` 约 1.30 万行，说明功能增长仍快于拆分速度。
- 0.15.0 首批把暂停队列恢复抽成可注入控制器，并修复二次异步检查未等待的问题。后续按“诊断/重试 → 状态门面 → 工作流 → 账号窗口”逐项迁移。
- `styles.css` 约 1.13 万行，暂不机械切文件；必须先确定稳定模块前缀和加载顺序，避免层叠变化造成真实界面回归。
- 旧表格保留为 2026-08-06 历史基线，不能再把其中行数当作当前值。

## 结论

`lib/` 层已天然支持并行；真正卡住多窗口的是三个巨石文件：`app.js`(11,883行)、`server.js`(6,265行)、`styles.css`(9,896行)。任何两个窗口只要都碰前端或后端，就必然撞同一个文件。

## 现状诊断

| 文件 | 行数 | 模块化程度 | 并行风险 |
|---|---|---|---|
| `lib/*.js`(13个) | 14–843 | 已拆好，一文件一域 | 低，改不同文件零冲突 |
| `app.js` | 11,883 | 单文件塞入所有前端逻辑 | 极高 |
| `server.js` | 6,265 | 原生 http 单 handler，所有路由内联 | 极高 |
| `styles.css` | 9,896 | 单文件全部样式 | 高 |
| `desktop/main.js` | 1,484 | 中等，Electron 主进程 | 中 |

`server.js` 用裸 `http` + `pathname.startsWith()` 手写路由（非 Express），6,265 行全在一个请求处理函数里；`app.js` 把 GPT 窗口管理、工作流、账号、生产、分发、设置、通用 UI 全揉在一起。

## 功能模块地图（8 个业务域）

每个域目前都横跨多个文件：

| 模块 | lib 层（已隔离✓） | server.js 路由 | app.js 函数 | 其他 |
|---|---|---|---|---|
| 素材生产 | production-recipes, image-generation, production-quality | `/api/production/*`, `/api/materials` | renderProductionWorkbench, loadProductionWorkspace | styles 生产样式 |
| GPT自动生产 | gpt-production-orchestrator | `/api/gpt-*` | loadGptWindowRuntime, renderGptModeWorkflow, saveGptAutoSettings | main.js 窗口管理, sidebar.js(扩展) |
| 分发 | distribution-data, transfer-progress, dedup-ledger | `/api/distribution/*`, `/api/transfers/*` | renderDistributionReserveAlert | styles 分发样式 |
| 转化 | — | `/conversion-integrated/*`, `/mobile-conversion/*` | 转化 tab 逻辑 | 外部转化服务 |
| 微信草稿 | wechat-draft | `/api/wechat-draft/*` | 草稿相关函数 | — |
| 备份 | webdav-backup | `/api/backup/*` | saveBackupSettingsFromUi | — |
| 工作台设置 | workbench-settings, workbench-port | `/api/settings/*` | openPageSettings, renderPageSettingsValues | — |
| 聚光数据 | juguang-data | `/api/juguang/*` | — | mcp/juguang-mcp.js |

## 多窗口冲突矩阵（现状）

| 窗口A ↔ 窗口B | lib层 | server.js | app.js | styles.css |
|---|---|---|---|---|
| 分发 ↔ 微信草稿 | ✓不冲突 | ✗撞同一文件 | ✗撞同一文件 | ✗撞同一文件 |
| 素材生产 ↔ GPT自动 | ✓不冲突 | ✗撞同一文件 | ✗撞同一文件 | ✗撞同一文件 |
| 分发 ↔ 备份 | ✓不冲突 | ✗撞同一文件 | ✗撞同一文件 | ✗撞同一文件 |

只有当两个窗口恰好都只碰 lib 时才安全；涉及界面或接口就撞 `app.js`/`server.js`/`styles.css` 之一。

## 拆分方案（目标结构）

核心：把三个巨石按 8 个功能域拆成独立文件，拆完后每个模块拥有自己独立的一组文件，多窗口各改各的文件，物理上不可能冲突。

```
src/
  server/
    index.js              # 入口，加载各模块路由
    routes/
      production.js        # /api/production/*, /api/materials
      gpt.js               # /api/gpt-*
      distribution.js      # /api/distribution/*, /api/transfers/*
      conversion.js        # /conversion-integrated/*, /mobile-conversion/*
      wechat-draft.js      # /api/wechat-draft/*
      backup.js            # /api/backup/*
      settings.js          # /api/settings/*
      juguang.js           # /api/juguang/*
  public/
    app/                   # app.js 拆分
      main.js              # 入口 + 通用UI(toast/escapeHtml/enhanceSelect)
      gpt-window.js        # GPT窗口管理
      gpt-workflow.js      # 工作流/模式
      gpt-accounts.js      # 账号
      production.js        # 素材生产工作台
      distribution.js      # 分发
      settings.js          # 设置页
      theme.js             # 主题
    styles/
      base.css
      production.css
      gpt.css
      distribution.css
      settings.css
  lib/                     # 保持不变，已经很好
  desktop/main.js          # 可按需拆，优先级低
```

拆完后冲突矩阵：

| 窗口A ↔ 窗口B | 拆分后 |
|---|---|
| 任意两个不同模块 | ✓ 全部独立文件，零冲突 |

## 过渡期协调协议（拆分未完成时）

在三个巨石拆完之前，多窗口要继续跑，立轻量"文件占用协议"：

- 每个窗口开工前声明自己要动的文件清单，谁先声明谁占用
- `app.js`/`server.js`/`styles.css` 同一时刻只允许一个窗口写，其他窗口只能读
- `lib/*.js` 和 `desktop/main.js` 可自由并行
- 这样能立刻把冲突风险降到最低，不用等拆分

## 推进顺序建议

1. **先拆 server.js 路由**（风险最低，纯接口层，有测试覆盖）——一次拆一个域，跑一轮 `npm test` 再继续
2. **再拆 app.js**（风险中，前端逻辑耦合较深，需配合 index.html 引入顺序调整）
3. **最后拆 styles.css**（风险低但量大，纯样式隔离，按模块前缀切分）
4. 每步拆完都要跑回归测试 + 桌面验收，参照 `docs/REGRESSION-CHECKLIST.md`

## 注意事项

- `server.js` 不是 Express，是裸 `http` 手写路由，拆分时需要保持原有 `pathname.startsWith()` 匹配语义，不能换框架
- `app.js` 函数间有大量全局变量共享（gptAutoSettings、activeGptAccountId 等），拆分时需要设计共享状态层，不能简单按函数切
- `styles.css` 拆分要注意 CSS 层叠顺序，后引入的覆盖先引入的
- `sidebar.js` 是浏览器扩展注入脚本，不在本项目内，单独维护
