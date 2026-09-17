# UTF-8 with BOM
$scriptPath = "D:\AICode\工具开发\projects\content-production-app\scripts\dual_browser_autonomous_producer.py"
$stdout = "D:\AICode\运行数据\dual_daemon_stdout.log"
$stderr = "D:\AICode\运行数据\dual_daemon_stderr.log"
$p = Start-Process -FilePath "python.exe" -ArgumentList "-u `"$scriptPath`"" -WorkingDirectory "D:\AICode" -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
Write-Host "PID: $($p.Id)"
