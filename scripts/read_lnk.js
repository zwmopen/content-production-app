const fs = require('fs');
const { execSync } = require('child_process');

const ps = `
$sh = New-Object -ComObject WScript.Shell
$t = $sh.CreateShortcut('C:\\Users\\z\\Desktop\\内容生产B.lnk')
Write-Host "Target: " $t.TargetPath
Write-Host "Args: " $t.Arguments
Write-Host "WorkingDir: " $t.WorkingDirectory
`;
fs.writeFileSync('temp_lnk.ps1', ps, 'utf8');
console.log(execSync('powershell -ExecutionPolicy Bypass -File temp_lnk.ps1').toString());
fs.unlinkSync('temp_lnk.ps1');
