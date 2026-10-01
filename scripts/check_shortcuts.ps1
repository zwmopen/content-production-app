$sh = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$names = @('zwmrpg.lnk', 'orlandocardozo706.lnk', '23.embrace.ping.lnk')
foreach ($name in $names) {
    $p = Join-Path $desktop $name
    if (Test-Path $p) {
        $lnk = $sh.CreateShortcut($p)
        Write-Host "=== $name ==="
        Write-Host "Target: $($lnk.TargetPath)"
        Write-Host "Args: $($lnk.Arguments)"
        Write-Host "WorkingDir: $($lnk.WorkingDirectory)"
    }
}
