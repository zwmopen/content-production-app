param(
    [string]$PackagerPath = "D:\AICode\运行数据\江湖有旅人\团建工作台\work-package\make_work_package.ps1"
)

$ErrorActionPreference = "Stop"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $PackagerPath,
    [ref]$tokens,
    [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
    throw ($parseErrors | Out-String)
}

$functionDefinitions = $ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $true)
Invoke-Expression (($functionDefinitions | ForEach-Object { $_.Extent.Text }) -join "`n`n")

$tempParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testRoot = Join-Path $tempParent ("tb-workpkg-grouping-" + [guid]::NewGuid().ToString("N"))
$library = Join-Path $testRoot "library"
$output = Join-Path $testRoot "mobile"

try {
    New-Item -ItemType Directory -Path $library, $output -Force | Out-Null
    1..7 | ForEach-Object {
        New-Item -ItemType Directory -Path (Join-Path $library ("20260807_10000{0}_安吉两天一夜团建路线" -f $_)) | Out-Null
    }
    1..7 | ForEach-Object {
        New-Item -ItemType Directory -Path (Join-Path $library ("20260807_11000{0}_办公室团建小游戏题库" -f $_)) | Out-Null
    }
    New-Item -ItemType Directory -Path (Join-Path $library "20260807_120001_宠物减脂日记") | Out-Null

    $result = Invoke-PortfolioAutoGroup `
        -LibraryDir $library `
        -PortfolioOutputDir $output `
        -BatchSize 7 `
        -PortfolioPrefix "作品集" `
        -LogFolderName "_logs" `
        -MinimumExistingNumber 55 `
        -CreateZip:$false

    $collections = @(Get-ChildItem -LiteralPath $output -Directory | Where-Object { $_.Name -ne "_logs" })
    $conversion = @($collections | Where-Object { $_.Name -match '\[转\]$' })
    $traffic = @($collections | Where-Object { $_.Name -match '\[泛\]$' })
    $remaining = @(Get-ChildItem -LiteralPath $library -Directory)

    if ($result.Batches -ne 2 -or $result.Moved -ne 14 -or $result.Leftover -ne 1) {
        throw "分组统计不符合预期：$($result | ConvertTo-Json -Compress)"
    }
    if ($conversion.Count -ne 1 -or @(Get-ChildItem -LiteralPath $conversion[0].FullName -Directory).Count -ne 7) {
        throw "转化类没有独立生成7套作品集"
    }
    if ($traffic.Count -ne 1 -or @(Get-ChildItem -LiteralPath $traffic[0].FullName -Directory).Count -ne 7) {
        throw "游戏/泛流量类没有独立生成7套作品集"
    }
    if ($remaining.Count -ne 1 -or $remaining[0].Name -notmatch '宠物减脂') {
        throw "无法判断的作品不应被混入作品集"
    }

    [pscustomobject]@{
        ok = $true
        parseErrors = $parseErrors.Count
        batches = $result.Batches
        moved = $result.Moved
        leftover = $result.Leftover
        collections = @($collections | ForEach-Object {
            [pscustomobject]@{
                name = $_.Name
                count = @(Get-ChildItem -LiteralPath $_.FullName -Directory).Count
            }
        })
        remaining = @($remaining | Select-Object -ExpandProperty Name)
    } | ConvertTo-Json -Depth 5
}
finally {
    $resolvedRoot = [System.IO.Path]::GetFullPath($testRoot)
    if ($resolvedRoot.StartsWith($tempParent, [System.StringComparison]::OrdinalIgnoreCase) -and
        [System.IO.Path]::GetFileName($resolvedRoot).StartsWith("tb-workpkg-grouping-")) {
        [System.IO.Directory]::Delete($resolvedRoot, $true)
    }
}
