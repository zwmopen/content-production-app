Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = fso.BuildPath(base, "start.vbs")
shell.Run Chr(34) & launcher & Chr(34), 0, False
