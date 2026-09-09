#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ExePath,
    [Alias('ConfigPath')] [string] $SettingsPath = $(if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'settings.json')) { Join-Path $PSScriptRoot 'settings.json' } else { Join-Path $PSScriptRoot 'initialize.example.json' }),
    [string] $SystemPath,
    [string] $RuntimesPath,
    [string] $SkillsPath,
    [switch] $Start,
    [string] $DataDirectory = $(if ($env:AGENT_DESKTOP_DATA_DIR) { $env:AGENT_DESKTOP_DATA_DIR } else { Join-Path $env:APPDATA 'AgentBridge' })
)

$ErrorActionPreference = 'Stop'
$temporaryDirectories = [System.Collections.Generic.List[string]]::new()

# Extract only regular files into a fresh directory; never trust ZIP entry paths.
function Expand-InputDirectory([string] $InputPath, [string] $FolderName) {
    if (-not $InputPath) { return '' }
    $source = (Resolve-Path -LiteralPath $InputPath).Path
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        if ([System.IO.Path]::GetExtension($source) -ine '.zip') { throw "$FolderName must be a directory or ZIP file." }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $destination = Join-Path ([System.IO.Path]::GetTempPath()) ('AgentBridge-' + [guid]::NewGuid().ToString('N'))
        [System.IO.Directory]::CreateDirectory($destination) | Out-Null
        $temporaryDirectories.Add($destination)
        $archive = [System.IO.Compression.ZipFile]::OpenRead($source)
        try {
            $names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
            [long] $bytes = 0
            if ($archive.Entries.Count -gt 200000) { throw 'ZIP contains too many entries.' }
            foreach ($entry in $archive.Entries) {
                $name = $entry.FullName.Replace('\', '/')
                $parts = $name.TrimEnd('/').Split('/')
                $fileType = ($entry.ExternalAttributes -shr 16) -band 61440
                if ($name.StartsWith('/') -or $name -match '[:\x00-\x1f]' -or
                    @($parts | Where-Object { $_ -in @('', '.', '..') -or $_ -match '[. ]$|^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)' }).Count -gt 0 -or
                    $fileType -notin @(0, 16384, 32768) -or ($entry.ExternalAttributes -band 1024) -ne 0 -or
                    -not $names.Add($name.TrimEnd('/'))) { throw 'ZIP contains an unsafe, duplicate or unsupported entry.' }
                $bytes += $entry.Length
                if ($bytes -gt 8GB) { throw 'ZIP exceeds the 8 GiB expanded size limit.' }
            }
            foreach ($entry in $archive.Entries) {
                $name = $entry.FullName.Replace('\', '/')
                $target = [System.IO.Path]::GetFullPath((Join-Path $destination $name))
                if (-not $target.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP entry escapes its destination.' }
                if ($name.EndsWith('/')) { [System.IO.Directory]::CreateDirectory($target) | Out-Null }
                else {
                    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null
                    $inputStream = $entry.Open()
                    try {
                        $outputStream = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew)
                        try {
                            $buffer = New-Object byte[] 65536
                            [long] $written = 0
                            while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                                $written += $count
                                if ($written -gt $entry.Length) { throw 'ZIP entry exceeds its declared size.' }
                                $outputStream.Write($buffer, 0, $count)
                            }
                            if ($written -ne $entry.Length) { throw 'ZIP entry is incomplete.' }
                        } finally { $outputStream.Dispose() }
                    } finally { $inputStream.Dispose() }
                }
            }
        } finally { $archive.Dispose() }
        $source = $destination
    }
    $nested = Join-Path $source $FolderName
    if (Test-Path -LiteralPath $nested -PathType Container) { return $nested }
    return $source
}

try {
    $exe = (Resolve-Path -LiteralPath $ExePath).Path
    $profileFile = (Resolve-Path -LiteralPath $SettingsPath).Path
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
    $runtimeDirectory = Expand-InputDirectory $RuntimesPath 'runtimes'
    $skillDirectory = Expand-InputDirectory $SkillsPath 'skills'
    $systemFile = if ($SystemPath) { (Resolve-Path -LiteralPath $SystemPath).Path } else { '' }
    # Named optional arguments survive empty-value handling in Windows PowerShell 5.1.
    $initializeArgs = @($helper, $backend, $data, $profileFile, $npm)
    if ($runtimeDirectory) { $initializeArgs += @('--runtimes', $runtimeDirectory) }
    if ($skillDirectory) { $initializeArgs += @('--skills', $skillDirectory) }
    if ($systemFile) { $initializeArgs += @('--system', $systemFile) }
    & $node @initializeArgs
    if ($LASTEXITCODE -ne 0) { throw "Initialization failed (exit $LASTEXITCODE). Saved configuration and completed installations are retained." }
    if ($Start) {
        $env:AGENT_DESKTOP_DATA_DIR = Split-Path -Parent $data
        Start-Process -FilePath $exe | Out-Null
    }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    foreach ($directory in $temporaryDirectories) { Remove-Item -LiteralPath $directory -Recurse -Force }
}
