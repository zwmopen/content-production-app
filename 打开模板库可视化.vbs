Option Explicit

Dim shell, fso, base, ps, command, exitCode, url, edge
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
ps = fso.BuildPath(base, "start-template-gallery.ps1")
url = "http://127.0.0.1:4327/template-gallery"
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & ps & Chr(34)
exitCode = shell.Run(command, 0, True)

edge = ""
If fso.FileExists("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe") Then
    edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
ElseIf fso.FileExists("C:\Program Files\Microsoft\Edge\Application\msedge.exe") Then
    edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
End If

If edge <> "" Then
    shell.Run Chr(34) & edge & Chr(34) & " --new-tab " & Chr(34) & url & Chr(34), 1, False
Else
    shell.Run "explorer.exe " & Chr(34) & url & Chr(34), 1, False
End If