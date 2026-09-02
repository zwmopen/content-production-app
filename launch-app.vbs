Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\AICode\工具开发\content-production-app-instances\A"
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-instance-a.ps1", 0, False
