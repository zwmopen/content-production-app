$scriptPath = "D:\AICode\工具开发\projects\content-production-app\scripts\autonomous_infinite_producer.py"
$stdout = "D:\AICode\运行数据\daemon_stdout.log"
$stderr = "D:\AICode\运行数据\daemon_stderr.log"
$p = Start-Process -FilePath "python.exe" -ArgumentList "-u `"$scriptPath`"" -WorkingDirectory "D:\AICode" -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
Write-Host "自主无限生产守护进程已启动！PID: $($p.Id)"
