# 测试与验收

## 自动测试

```powershell
Set-Location 'D:\AICode\工具开发\projects\teambuilding-workflow-dashboard\src'
npm test
```

当前覆盖：

- 路径边界、公开文件解析和原子 Junction 整合；
- `[泛]` / `[转]` 分类、双平台同源判断、断链和归档异常；
- 公众号待上传到人工确认的追加日志；
- 作品集组合筛选和平台状态文案；
- 分发脚本参数白名单。

2026-07-24 在 Windows 本机执行：17 项测试通过；浏览器手动验证总览、素材生产、作品集筛选、分发页签、在线设备扫描和三种主题。
