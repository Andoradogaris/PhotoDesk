Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = baseDir
command = "cmd.exe /c " & Chr(34) & baseDir & "\lancer-photo-desk.cmd" & Chr(34)
shell.Run command, 0, False
