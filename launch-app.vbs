Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\AICode\工具开发\content-production-app-instances\C"
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-instance-c.ps1", 0, False
