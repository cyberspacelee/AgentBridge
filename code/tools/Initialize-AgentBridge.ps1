#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ExePath,
    [string] $ConfigPath = (Join-Path $PSScriptRoot 'initialize.example.json'),
    [string] $RuntimesPath,
    [string] $DataDirectory = $(if ($env:AGENT_DESKTOP_DATA_DIR) { $env:AGENT_DESKTOP_DATA_DIR } else { Join-Path $env:APPDATA 'AgentBridge' })
)

$ErrorActionPreference = 'Stop'
try {
    $exe = (Resolve-Path -LiteralPath $ExePath).Path
    $profileFile = (Resolve-Path -LiteralPath $ConfigPath).Path
    $resources = Join-Path (Split-Path -Parent $exe) 'resources'
    $node = Join-Path $resources 'node\node.exe'
    $npm = Join-Path $resources 'node\node_modules\npm\bin\npm-cli.js'
    $backend = Join-Path $resources 'backend'
    $helper = Join-Path $PSScriptRoot 'initialize.mjs'
    foreach ($required in @($node, $npm, $helper, (Join-Path $backend 'dist\src\main.js'))) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Missing file: $required. ExePath must point to the installed application, not the installer."
        }
    }
    $data = Join-Path ([System.IO.Path]::GetFullPath($DataDirectory)) 'data'
    Write-Host "Initializing AgentBridge data: $data"
    Write-Host 'Exit AgentBridge from its tray/menu before running this script.'
    $initializeArgs = @($helper, $backend, $data, $profileFile, $npm)
    if ($RuntimesPath) { $initializeArgs += (Resolve-Path -LiteralPath $RuntimesPath).Path }
    & $node @initializeArgs
    if ($LASTEXITCODE -ne 0) { throw "Initialization failed (exit $LASTEXITCODE). Saved configuration and completed installations are retained." }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
