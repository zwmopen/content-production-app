# 固定会话 CDP 执行器兼容入口

本地开发 2.6.5，未发布、未实机发送。唯一实现、17 项测试、样例与详细运行合同已归并到 [teambuilding-production-3modes 技能](../../../../.agents/skills/teambuilding-production-3modes/SKILL.md)。本项目 `scripts/isolated_fixed_cdp_adapter.py` 只路由到该技能，不维护另一份执行器。

- 本仓库布局自动向上查找 `.agents/skills/teambuilding-production-3modes`；独立安装通过环境变量 `TEAMBUILDING_3MODES_SKILL_ROOT` 指定技能目录。缺失时明确失败，不回退旧 producer。
- [完整执行器合同](../../../../.agents/skills/teambuilding-production-3modes/docs/ISOLATED-CDP-ADAPTER.md)、[私有配置样例](../../../../.agents/skills/teambuilding-production-3modes/config/isolated_fixed_cdp_adapter.example.json)、依赖文件 `requirements.txt` 均以技能为真源。App 的 example JSON 仅是文档指针，不能直接作为运行配置。
- 老 CLI 保持 `--request / --receipt / --config / --plan [--execute]`；无 `--execute` 只离线预检。测试兼容入口导入同一 canonical 17 个测试。
- 面板仍仅登记指令。实际账号、母版学习回执、selectors、独占证据、真实完整套图、QA/11 版本文案/飞书闭环尚待主执行者验收。离线 34 项通过不能称三条产线打通。
