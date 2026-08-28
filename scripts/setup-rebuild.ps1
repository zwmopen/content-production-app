#requires -Version 5.1

[CmdletBinding()]
param(
    [switch]$SkipNode,
    [switch]$SkipPython,
    [switch]$Validate
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'src'

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $false)][string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed (exit code $LASTEXITCODE): $FilePath $($Arguments -join ' ')"
    }
}

if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Source directory not found: $sourceRoot"
}

Write-Host "Preparing the workbench runtime: $sourceRoot"

if (-not $SkipNode) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        throw 'npm was not found. Install Node.js 18+ and run this script again.'
    }

    Push-Location $sourceRoot
    try {
        Write-Host 'Installing Node dependencies (npm ci)...'
        Invoke-Checked -FilePath $npm.Source -Arguments @('ci')
    }
    finally {
        Pop-Location
    }
}

if (-not $SkipPython) {
    $python = Get-Command py -ErrorAction SilentlyContinue
    $pythonArguments = @('-3')
    if (-not $python) {
        $python = Get-Command python -ErrorAction SilentlyContinue
        $pythonArguments = @()
    }
    if (-not $python) {
        throw 'Python 3 was not found. Install Python 3.10+ and run this script again.'
    }

    $venvRoot = Join-Path $sourceRoot '.venv-moments'
    $venvPython = Join-Path $venvRoot 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        Write-Host 'Creating the Moments Python environment...'
        Invoke-Checked -FilePath $python.Source -Arguments ($pythonArguments + @('-m', 'venv', $venvRoot))
    }

    $requirements = Join-Path $sourceRoot 'requirements-moments.txt'
    if (-not (Test-Path -LiteralPath $requirements -PathType Leaf)) {
        throw "Moments requirements file not found: $requirements"
    }

    Write-Host 'Installing Moments Python dependencies...'
    Invoke-Checked -FilePath $venvPython -Arguments @('-m', 'pip', 'install', '-r', $requirements)
}

if ($Validate) {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        throw 'Validation requires npm, but npm was not found.'
    }

    Push-Location $sourceRoot
    try {
        Write-Host 'Running Node regression tests...'
        Invoke-Checked -FilePath $npm.Source -Arguments @('test', '--silent')
    }
    finally {
        Pop-Location
    }
}

Write-Host ''
Write-Host 'Runtime preparation is complete.'
Write-Host 'Validate: cd src; npm test'
Write-Host 'Build:    cd src; npm run dist:portable'
Write-Host 'Run:      cd src; npm start'
