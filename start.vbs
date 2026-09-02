Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(base, "start-instance-d.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & script & Chr(34)
shell.Run command, 0, False
