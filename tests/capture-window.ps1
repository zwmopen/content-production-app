param(
  [string]$Title = "",
  [string]$Output = "D:\release-window.png"
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WindowCaptureNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

$process = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and ($Title -eq "" -or $_.MainWindowTitle -eq $Title)
} | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $process) { throw "Release window not found" }
[WindowCaptureNative]::ShowWindow($process.MainWindowHandle, 9) | Out-Null
[WindowCaptureNative]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800
$rect = New-Object WindowCaptureNative+RECT
[WindowCaptureNative]::GetWindowRect($process.MainWindowHandle, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object Drawing.Bitmap $width, $height
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
$directory = Split-Path -Parent $Output
if ($directory -and $directory -ne [IO.Path]::GetPathRoot($directory)) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
$bitmap.Save($Output, [Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output $Output
