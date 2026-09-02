Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\AICode\工具开发\content-production-app-instances\D"
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-instance-d.ps1", 0, False
