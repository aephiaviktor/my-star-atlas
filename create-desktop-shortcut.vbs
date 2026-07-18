Option Explicit

Dim shell, fileSystem, appDirectory, desktopDirectory, shortcut
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
appDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
desktopDirectory = shell.SpecialFolders("Desktop")

Set shortcut = shell.CreateShortcut(fileSystem.BuildPath(desktopDirectory, "My Star Atlas.lnk"))
shortcut.TargetPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
shortcut.Arguments = Chr(34) & fileSystem.BuildPath(appDirectory, "launch-my-star-atlas.vbs") & Chr(34)
shortcut.WorkingDirectory = appDirectory
shortcut.IconLocation = fileSystem.BuildPath(appDirectory, "electron\assets\my-star-atlas.ico") & ",0"
shortcut.Description = "Aephia My Star Atlas"
shortcut.Save

MsgBox "My Star Atlas shortcut created on the desktop.", 64, "My Star Atlas"
