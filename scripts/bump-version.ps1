#requires -Version 5.1
<#
.SYNOPSIS
    Atualiza a versão do Lumina em todos os arquivos de origem.

.DESCRIPTION
    Interativo. Não compila, não roda testes e não gera instalador.
    Mantém a mesma versão em package.json, Cargo.toml, tauri.conf.json,
    src/lib/appVersion.ts e Cargo.lock.

.PARAMETER Version
    Versão alvo (ex.: 0.2.0). Sem ele, o menu interativo é aberto.

.PARAMETER Patch
    Sobe o patch: 0.1.0 -> 0.1.1.

.PARAMETER Minor
    Sobe o minor: 0.1.0 -> 0.2.0.

.PARAMETER Major
    Sobe o major: 0.1.0 -> 1.0.0.

.PARAMETER Force
    Permite rebaixar a versão sem a confirmação extra de downgrade.

.PARAMETER Yes
    Não pede a confirmação final.

.EXAMPLE
    .\scripts\bump-version.ps1

.EXAMPLE
    .\scripts\bump-version.ps1 -Minor

.EXAMPLE
    .\scripts\bump-version.ps1 0.2.0 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Position = 0)]
    [string]$Version,
    [switch]$Patch,
    [switch]$Minor,
    [switch]$Major,
    [switch]$Force,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
# Keep accented output readable in Windows Terminal/PowerShell 7 and in legacy
# consoles that support UTF-8. The script itself is saved as UTF-8 with BOM so
# Windows PowerShell 5.1 parses the Portuguese strings correctly.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cli = Join-Path $root 'scripts/set-version.mjs'
if (-not (Test-Path -LiteralPath $cli)) {
    throw "Script de versão não encontrado: $cli"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw 'Node.js não encontrado no PATH. Instale o Node 20+ e tente novamente.'
}

function Invoke-VersionCli {
    param(
        [string[]]$Arguments,
        [switch]$Capture
    )
    if ($Capture) {
        $output = & $node.Source $cli @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw ($output -join [Environment]::NewLine)
        }
        return ($output -join [Environment]::NewLine)
    }
    & $node.Source $cli @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao atualizar a versão (código $LASTEXITCODE)."
    }
}

function Get-CoreVersion {
    param([string]$Value)
    $match = [regex]::Match($Value, '^v?(\d+)\.(\d+)\.(\d+)')
    if (-not $match.Success) {
        throw "Versão inválida: $Value"
    }
    [pscustomobject]@{
        Major = [int]$match.Groups[1].Value
        Minor = [int]$match.Groups[2].Value
        Patch = [int]$match.Groups[3].Value
    }
}

function Test-VersionInput {
    param([string]$Value)
    return $Value -match '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$' -and -not $Value.Contains('..')
}

$bumpCount = 0
if ($Patch) { $bumpCount += 1 }
if ($Minor) { $bumpCount += 1 }
if ($Major) { $bumpCount += 1 }

if ($Version -and $bumpCount -gt 0) {
    throw 'Use -Version OU -Patch/-Minor/-Major, não os dois.'
}
if ($bumpCount -gt 1) {
    throw 'Escolha apenas um bump: -Patch, -Minor ou -Major.'
}

$state = (Invoke-VersionCli -Arguments @('--state') -Capture) | ConvertFrom-Json
if (-not $state.packageVersion) {
    throw 'Não foi possível ler a versão atual de package.json.'
}

$core = Get-CoreVersion $state.packageVersion
$nextPatch = "$($core.Major).$($core.Minor).$($core.Patch + 1)"
$nextMinor = "$($core.Major).$($core.Minor + 1).0"
$nextMajor = "$($core.Major + 1).0.0"

Write-Host ''
Write-Host 'Lumina - atualização de versão' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Fontes atuais:' -ForegroundColor DarkGray
$rows = @(
    [pscustomobject]@{ File = 'package.json'; Version = $state.packageVersion },
    [pscustomobject]@{ File = 'Cargo.toml'; Version = $state.cargoVersion },
    [pscustomobject]@{ File = 'tauri.conf.json'; Version = $state.tauriVersion },
    [pscustomobject]@{ File = 'appVersion.ts'; Version = $state.uiVersion },
    [pscustomobject]@{ File = 'Cargo.lock'; Version = $state.lockVersion }
)
foreach ($row in $rows) {
    $color = if ($row.Version -ne $state.packageVersion) { 'Yellow' } else { 'Gray' }
    Write-Host ('  {0,-22} {1}' -f $row.File, $row.Version) -ForegroundColor $color
}
if (($rows | Select-Object -ExpandProperty Version -Unique).Count -gt 1) {
    Write-Host ''
    Write-Host '  As fontes estão divergentes; todas serão alinhadas à versão escolhida.' -ForegroundColor Yellow
}

$target = $null
if ($Version) {
    $target = $Version.Trim() -replace '^[vV]', ''
    if (-not (Test-VersionInput $target)) {
        throw "Versão inválida: $Version. Use major.minor.patch, opcionalmente com -prerelease."
    }
} elseif ($Patch) {
    $target = $nextPatch
} elseif ($Minor) {
    $target = $nextMinor
} elseif ($Major) {
    $target = $nextMajor
} else {
    Write-Host ''
    Write-Host 'Escolha a nova versão:' -ForegroundColor DarkGray
    Write-Host "  [1] Patch         $nextPatch"
    Write-Host "  [2] Minor         $nextMinor"
    Write-Host "  [3] Major         $nextMajor"
    Write-Host '  [4] Personalizada'
    Write-Host '  [Q] Cancelar'

    while (-not $target) {
        $choice = (Read-Host 'Opção [1]').Trim()
        if ([string]::IsNullOrWhiteSpace($choice)) {
            $choice = '1'
        }
        switch -Regex ($choice) {
            '^1$' { $target = $nextPatch }
            '^2$' { $target = $nextMinor }
            '^3$' { $target = $nextMajor }
            '^4$' {
                $typed = (Read-Host 'Digite a versão (ex.: 0.2.0)').Trim()
                if (-not [string]::IsNullOrWhiteSpace($typed)) {
                    $normalized = $typed -replace '^[vV]', ''
                    if (Test-VersionInput $normalized) {
                        $target = $normalized
                    } else {
                        Write-Host 'Versão inválida. Use major.minor.patch, opcionalmente com -prerelease.' -ForegroundColor Yellow
                    }
                }
            }
            '^(q|Q)$' {
                Write-Host 'Cancelado.' -ForegroundColor DarkGray
                return
            }
            default {
                Write-Host 'Opção inválida.' -ForegroundColor Yellow
            }
        }
    }
}

$comparison = [int]((Invoke-VersionCli -Arguments @('--compare', $target) -Capture).Trim())
if ($comparison -eq 0) {
    Write-Host "A versão atual já é $target. Nada foi alterado." -ForegroundColor Yellow
    return
}

$allowDowngrade = $false
if ($comparison -lt 0) {
    Write-Host ''
    Write-Host "Atenção: $target é menor que a versão atual ($($state.packageVersion))." -ForegroundColor Yellow
    if (-not $Force) {
        $answer = Read-Host 'Digite "rebaixar" para confirmar'
        if ($answer -ne 'rebaixar') {
            Write-Host 'Cancelado.' -ForegroundColor DarkGray
            return
        }
    }
    $allowDowngrade = $true
}

Write-Host ''
Write-Host "Versão: $($state.packageVersion) -> $target" -ForegroundColor White
Write-Host 'Arquivos: package.json, Cargo.toml, tauri.conf.json, appVersion.ts, Cargo.lock'
Write-Host 'Nenhum build será executado.' -ForegroundColor DarkGray

$cliArgs = @($target)
if ($allowDowngrade) {
    $cliArgs += '--allow-downgrade'
}

if ($WhatIfPreference) {
    $previewArgs = $cliArgs + '--dry-run'
    Invoke-VersionCli -Arguments $previewArgs
    return
}

if (-not $Yes) {
    $answer = Read-Host 'Aplicar? [S/n]'
    if ($answer -and $answer -notmatch '^[sSyY]') {
        Write-Host 'Cancelado.' -ForegroundColor DarkGray
        return
    }
}

Invoke-VersionCli -Arguments $cliArgs

$after = (Invoke-VersionCli -Arguments @('--state') -Capture) | ConvertFrom-Json
$versions = @(
    $after.packageVersion,
    $after.cargoVersion,
    $after.tauriVersion,
    $after.uiVersion,
    $after.lockVersion
) | Select-Object -Unique

Write-Host ''
if ($versions.Count -eq 1) {
    Write-Host "Todas as fontes estão em $($after.packageVersion)." -ForegroundColor Green
} else {
    Write-Host "Atenção: as fontes ficaram divergentes: $($versions -join ', ')" -ForegroundColor Yellow
}
Write-Host 'Revise com: git diff' -ForegroundColor DarkGray
Write-Host 'Para publicar: commit + push para a main (o workflow cria a tag e a release).' -ForegroundColor DarkGray
