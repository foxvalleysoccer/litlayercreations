param(
    [string]$RepoRoot = $PSScriptRoot,
    [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-PreviewEntry {
    param([System.IO.Compression.ZipArchive]$Archive)

    $thumb = $Archive.GetEntry('Auxiliaries/.thumbnails/thumbnail_3mf.png')
    if ($null -ne $thumb) {
        return $thumb
    }

    return $Archive.GetEntry('Metadata/plate_1.png')
}

function Get-MediaDirectory {
    param([System.IO.FileInfo]$ThreeMfFile)

    $categoryDir = $ThreeMfFile.Directory
    $productName = $ThreeMfFile.BaseName
    $lowerMedia = Join-Path $categoryDir.FullName 'media'
    $upperMedia = Join-Path $categoryDir.FullName 'Media'

    if (Test-Path -LiteralPath (Join-Path $lowerMedia $productName) -PathType Container) {
        return (Join-Path $lowerMedia $productName)
    }

    if (Test-Path -LiteralPath (Join-Path $upperMedia $productName) -PathType Container) {
        return (Join-Path $upperMedia $productName)
    }

    if (Test-Path -LiteralPath $upperMedia -PathType Container) {
        return (Join-Path $upperMedia $productName)
    }

    return (Join-Path $lowerMedia $productName)
}

function Write-PreviewFile {
    param(
        [System.IO.Compression.ZipArchiveEntry]$Entry,
        [string]$OutputPath
    )

    $dir = Split-Path -Parent $OutputPath
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $source = $Entry.Open()
    try {
        $target = [System.IO.File]::Create($OutputPath)
        try {
            $source.CopyTo($target)
        }
        finally {
            $target.Dispose()
        }
    }
    finally {
        $source.Dispose()
    }
}

$threeMfFiles = Get-ChildItem -LiteralPath $RepoRoot -Recurse -File -Filter '*.3mf' |
    Where-Object { $_.FullName -notmatch '\\(media|Media)\\' }

$written = 0
$skipped = 0

foreach ($threeMf in $threeMfFiles) {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($threeMf.FullName)
    try {
        $preview = Get-PreviewEntry -Archive $archive
        if ($null -eq $preview) {
            Write-Output "SKIP  $($threeMf.FullName) :: no embedded preview image"
            $skipped++
            continue
        }

        $mediaDir = Get-MediaDirectory -ThreeMfFile $threeMf
        $outputPath = Join-Path $mediaDir '3mf-preview.png'
        Write-Output "WRITE $outputPath <= $($threeMf.FullName)"

        if (-not $WhatIf) {
            Write-PreviewFile -Entry $preview -OutputPath $outputPath
        }

        $written++
    }
    finally {
        $archive.Dispose()
    }
}

Write-Output ""
Write-Output "Written: $written"
Write-Output "Skipped: $skipped"
