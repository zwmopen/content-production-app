# 图文工作台配套软件重建说明

这份仓库交付的是“图文工作台 + 配套技能执行器”的可重建源码。依赖清单、朋友圈采集/整理/发布准备代码、模板与素材技能代码、测试和便携版打包配置都在仓库内。

## 一次准备

在 Windows 新机器上，从项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-rebuild.ps1
```

这个入口会：

1. 在 `src` 下按 `package-lock.json` 执行 `npm ci`；
2. 创建 `src\.venv-moments`，并按 `src\requirements-moments.txt` 安装朋友圈配套 Python 依赖；
3. 不读取、不写入账号密码、WeFlow 原始数据或发布授权。

如果只需要重建主应用，可以使用 `-SkipPython`；如果只需要准备朋友圈配套环境，可以使用 `-SkipNode`。需要顺便跑 Node 回归时追加 `-Validate`。

## 验证与构建

```powershell
Set-Location .\src
npm test
npm run dist:portable
```

便携版输出到 `src/package.json` 中当前 `build.directories.output` 指定的版本目录。开发运行使用 `npm start`，桌面壳使用 `npm run desktop`。

朋友圈配套 Python 测试：

```powershell
Set-Location .\src
.\.venv-moments\Scripts\python.exe -m unittest discover -s moments_library -p 'test_*.py'
.\.venv-moments\Scripts\python.exe -m unittest discover -s moments_publisher -p 'test_*.py'
```

## 哪些内容不推送

以下内容属于机器运行状态，不属于可交付源码，因此不会进入 Git：

- `src\node_modules`、`src\.venv-moments`：可由锁文件和依赖清单重建；
- WeFlow 聊天/朋友圈原始数据、账号授权、Cookie、Token 和私密配置：绑定具体机器或账号；
- 日志、临时素材、构建产物、测试现场目录和备份文件：不能作为稳定版本输入。

因此，“换一台机器能否重新构建”依赖的是本说明、源码、锁文件和依赖清单，而不是复制本机运行目录。朋友圈发布流程仍保留最终人工确认，不会因为重建应用就自动替用户发表内容。
