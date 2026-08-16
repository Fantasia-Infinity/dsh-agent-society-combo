# dsh-agent-society-combo bootstrap installer (Windows PowerShell).
#
# One-liner:
#   irm https://raw.githubusercontent.com/Fantasia-Infinity/dsh-agent-society-combo/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$ComboRepo = if ($env:COMBO_REPO) { $env:COMBO_REPO } else { 'https://github.com/Fantasia-Infinity/dsh-agent-society-combo.git' }
$ComboRef = if ($env:COMBO_REF) { $env:COMBO_REF } else { 'main' }
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-agent-society-combo-install." + $PID)

try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'git is required. Install git first.'
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js 22.19 or newer is required. Install Node.js first.'
    }
    $NodeMajor = [int](node -p 'Number(process.versions.node.split(".")[0])')
    if ($NodeMajor -lt 22) {
        throw "Node.js 22.19 or newer is required (found $(node --version))."
    }

    # Manual-clone mode: when this script itself lives inside a combo checkout,
    # install from that checkout instead of downloading another copy.
    if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'scripts/install.mjs')) -and (Test-Path (Join-Path $PSScriptRoot 'sources.lock.json'))) {
        Push-Location $PSScriptRoot
        try {
            node scripts/install.mjs @args
        } finally {
            Pop-Location
        }
        return
    }

    New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
    git clone --quiet --depth 1 --branch $ComboRef $ComboRepo (Join-Path $TempRoot 'combo')
    Push-Location (Join-Path $TempRoot 'combo')
    node scripts/install.mjs @args
    Pop-Location
} finally {
    if (Test-Path $TempRoot) {
        Remove-Item -Recurse -Force $TempRoot -ErrorAction SilentlyContinue
    }
}
