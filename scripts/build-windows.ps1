#requires -Version 5.1
<#
.SYNOPSIS
    Builds the production Windows binary and its installer, mirroring the
    Release workflow (.github/workflows/installer.yml) for Windows only.

.DESCRIPTION
    Wrapper around scripts/build-installer.mjs with --platform windows. It
    validates the toolchain, installs the JS dependencies from the lockfile and
    runs the release build: catalog sync, Tauri release compilation and
    installer artifact collection.

    The test suite (typecheck, Vitest, script tests and cargo test) is skipped by
    default for fast local rebuilds; pass -RunTests to include it.

    Output:
      release/<version>/windows-<arch>/
        Zylara-Setup-<version>-windows-<arch>.exe   app + installer wizard
        release.json                                build manifest
        SHA256SUMS.txt                              checksums

    The Windows artifact is the app binary itself; it enters setup mode when
    its file name contains "setup" (see docs/INSTALLER.md).

.PARAMETER Version
    Writes this version to all five version sources before building.

.PARAMETER RunTests
    Runs typecheck, Vitest, script tests and cargo tests before compiling.
    Tests are skipped by default; this switch opts back into the full suite.

.PARAMETER SkipTests
    Deprecated no-op: tests are already skipped by default. Kept so existing
    invocations keep working. When combined with -RunTests, -RunTests wins.

.PARAMETER SkipInstall
    Skips "pnpm install --frozen-lockfile" (node_modules must be present).

.PARAMETER AllowDirty
    Allows an uncommitted worktree. Release builds refuse a dirty tree by
    default, matching the workflow's --require-clean.

.PARAMETER NoSign
    Skips Authenticode signing.

.PARAMETER CertThumbprint
    SHA-1 thumbprint of the Authenticode certificate. Defaults to the
    ZYLARA_WINDOWS_CERT_THUMBPRINT environment variable.

.PARAMETER TimestampUrl
    RFC 3161 timestamp server. Defaults to ZYLARA_TIMESTAMP_URL or the signtool
    default (http://timestamp.digicert.com).

.PARAMETER Arch
    Target architecture: host (default), x64 or arm64.

.PARAMETER Channel
    Channel recorded in release.json. Default: stable.

.PARAMETER DryRun
    Validates toolchain, version, git state and assets without compiling.

.EXAMPLE
    .\scripts\build-windows.ps1

.EXAMPLE
    .\scripts\build-windows.ps1 -RunTests -AllowDirty

.EXAMPLE
    .\scripts\build-windows.ps1 -Version 0.9.1 -CertThumbprint <thumbprint>
#>
[CmdletBinding()]
param(
    [string]$Version,
    [switch]$RunTests,
    [switch]$SkipTests,
    [switch]$SkipInstall,
    [switch]$AllowDirty,
    [switch]$NoSign,
    [string]$CertThumbprint = $env:ZYLARA_WINDOWS_CERT_THUMBPRINT,
    [string]$TimestampUrl = $env:ZYLARA_TIMESTAMP_URL,
    [ValidateSet('host', 'x64', 'arm64')]
    [string]$Arch = 'host',
    [string]$Channel = 'stable',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildScript = Join-Path $root 'scripts/build-installer.mjs'

if (-not (Test-Path -LiteralPath $buildScript)) {
    throw "Build script not found: $buildScript"
}
if ($env:OS -ne 'Windows_NT') {
    throw 'This script builds Windows artifacts and must run on Windows.'
}

function Resolve-Tool {
    param([string]$Name, [string]$Hint)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "$Name was not found in PATH. $Hint"
    }
    return $command.Path
}

# Fail before the long build instead of after it.
$null = Resolve-Tool 'node' 'Install Node.js 20 or newer.'
$pnpm = Resolve-Tool 'pnpm' 'Enable it with "corepack enable" or install pnpm 10.'
$null = Resolve-Tool 'cargo' 'Install the Rust toolchain (rustup, MSVC target).'

function Invoke-Pnpm {
    param([string[]]$PnpmArgs)
    Write-Host ''
    Write-Host ('> pnpm ' + ($PnpmArgs -join ' ')) -ForegroundColor DarkGray
    $global:LASTEXITCODE = 0
    & $pnpm @PnpmArgs
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm failed with exit code $LASTEXITCODE."
    }
}

Push-Location $root
try {
    $packageVersion = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    $versionLabel = if ($Version) { "$packageVersion -> $Version" } else { $packageVersion }
    $testLabel = if ($RunTests) { 'typecheck + vitest + script tests + cargo test (-RunTests)' } else { 'skipped (default); use -RunTests to enable' }
    $signLabel = if ($NoSign) { 'disabled (-NoSign)' } elseif ($CertThumbprint) { 'Authenticode' } else { 'unsigned (no certificate thumbprint)' }
    $gitLabel = if ($AllowDirty) { 'dirty tree allowed' } else { 'clean tree required' }

    Write-Host ''
    Write-Host 'Zylara - production build for Windows' -ForegroundColor Cyan
    Write-Host "  platform : windows ($Arch)"
    Write-Host "  version  : $versionLabel"
    Write-Host "  channel  : $Channel"
    Write-Host "  tests    : $testLabel"
    Write-Host "  signing  : $signLabel"
    Write-Host "  git      : $gitLabel"
    Write-Host "  output   : release\<version>\windows-<arch>\"

    if ($SkipTests -and -not $RunTests) {
        Write-Host ''
        Write-Host '[build-windows] -SkipTests is the default now and is ignored.' -ForegroundColor DarkGray
    }

    if ($CertThumbprint) { $env:ZYLARA_WINDOWS_CERT_THUMBPRINT = $CertThumbprint }
    if ($TimestampUrl) { $env:ZYLARA_TIMESTAMP_URL = $TimestampUrl }

    if ($DryRun) {
        Write-Host ''
        Write-Host '[build-windows] dry run; dependencies and compilation are skipped.' -ForegroundColor DarkGray
    } elseif ($SkipInstall) {
        Write-Host ''
        Write-Host '[build-windows] pnpm install skipped (-SkipInstall).' -ForegroundColor DarkGray
    } else {
        Invoke-Pnpm @('install', '--frozen-lockfile')
    }

    $installerArguments = @(
        'installer',
        '--platform', 'windows',
        '--arch', $Arch,
        '--channel', $Channel
    )
    if ($Version) { $installerArguments += @('--version', $Version) }
    if (-not $RunTests) { $installerArguments += '--skip-tests' }
    if (-not $AllowDirty) { $installerArguments += '--require-clean' }
    if ($NoSign) { $installerArguments += '--no-sign' }
    if ($DryRun) { $installerArguments += '--dry-run' }

    Invoke-Pnpm $installerArguments

    if ($DryRun) {
        Write-Host ''
        Write-Host '[build-windows] dry run complete.' -ForegroundColor Green
        return
    }

    # Re-read the version because --version rewrites every version source.
    $releaseVersion = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    $versionRoot = Join-Path $root (Join-Path 'release' $releaseVersion)
    $outputDir = $null
    if (Test-Path -LiteralPath $versionRoot) {
        $outputDir = Get-ChildItem -LiteralPath $versionRoot -Directory -Filter 'windows-*' |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
    }
    if (-not $outputDir) {
        throw "Build finished but no Windows output was found under $versionRoot."
    }

    $signed = 'unknown'
    $manifestPath = Join-Path $outputDir.FullName 'release.json'
    if (Test-Path -LiteralPath $manifestPath) {
        $signed = (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).signed
    }

    Write-Host ''
    Write-Host '[build-windows] done' -ForegroundColor Green
    Write-Host "  folder   : $($outputDir.FullName)"
    Write-Host "  signed   : $signed"
    foreach ($file in Get-ChildItem -LiteralPath $outputDir.FullName -File | Sort-Object Name) {
        Write-Host ('  file     : {0} ({1:N2} MB)' -f $file.Name, ($file.Length / 1MB))
    }

    $installer = Get-ChildItem -LiteralPath $outputDir.FullName -Filter 'Zylara-Setup-*.exe' -File |
        Select-Object -First 1
    if ($installer) {
        $hash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        Write-Host "  sha256   : $hash"
        Write-Host ''
        Write-Host "Installer: $($installer.FullName)"
    }
} catch {
    Write-Host ''
    Write-Host ('[build-windows] FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
