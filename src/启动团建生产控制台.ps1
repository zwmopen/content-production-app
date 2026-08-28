$ErrorActionPreference = 'Stop'
$launcher = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'launch.ps1'
& $launcher
