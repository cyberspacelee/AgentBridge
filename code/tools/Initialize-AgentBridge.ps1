#Requires -Version 5.1
[CmdletBinding()]
param(
    [string] $ExePath,
    [string] $InstallerPath,
    [string] $InstallDirectory,
    [Alias('ConfigPath')] [string] $SettingsPath,
    [string] $SystemPath,
    [string] $RuntimesPath,
    [string] $SkillsPath,
    [switch] $Start,
    [string] $DataDirectory = $(if ($env:AGENT_DESKTOP_DATA_DIR) { $env:AGENT_DESKTOP_DATA_DIR } else { Join-Path $env:APPDATA 'AgentBridge' })
)

$ErrorActionPreference = 'Stop'
$temporaryDirectories = [System.Collections.Generic.List[string]]::new()

function Find-BundleInput([string] $Name, [switch] $Archive) {
    $names = @($Name)
    if ($Archive) { $names += "$Name.zip" }
    $found = @($names | ForEach-Object { Join-Path $PSScriptRoot $_ } | Where-Object { Test-Path -LiteralPath $_ })
    if ($found.Count -gt 1) { throw "Both $Name and $Name.zip exist; specify the input path explicitly." }
    if ($found.Count -eq 1) { return $found[0] }
    return ''
}

function Install-Application([string] $Installer, [string] $Destination) {
    $destinationPath = [System.IO.Path]::GetFullPath($Destination)
    if ($destinationPath -match '["\r\n]' -or -not [System.IO.Path]::IsPathRooted($Destination)) { throw 'InstallDirectory must be an absolute path without quotes or newlines.' }
    $application = Join-Path $destinationPath 'agentbridge.exe'
    if (Test-Path -LiteralPath $application -PathType Leaf) {
        Write-Host "Using installed application: $application"
        return $application
    }
    if (-not $Installer) {
        $installers = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'AgentBridge*.exe' -File | Where-Object { $_.Name -ine 'agentbridge.exe' })
        if ($installers.Count -ne 1) { throw 'Expected one AgentBridge installer beside the script; specify -InstallerPath or -ExePath.' }
        $Installer = $installers[0].FullName
    }
    $installerFile = (Resolve-Path -LiteralPath $Installer).Path
    if ([System.IO.Path]::GetExtension($installerFile) -ine '.exe' -or -not (Test-Path -LiteralPath $installerFile -PathType Leaf)) { throw 'InstallerPath must point to an AgentBridge NSIS installer EXE.' }
    Write-Host "Installing AgentBridge to: $destinationPath"
    # NSIS requires /D last, without quoting even when the directory contains spaces.
    $process = Start-Process -FilePath $installerFile -ArgumentList "/S /currentuser /D=$destinationPath" -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "AgentBridge installation failed (exit $($process.ExitCode)). Initialization was not started." }
    if (-not (Test-Path -LiteralPath $application -PathType Leaf)) { throw "Installer finished but agentbridge.exe is missing: $destinationPath" }
    return $application
}

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
    if ($ExePath -and ($InstallerPath -or $InstallDirectory)) { throw 'Use -ExePath for an installed app, or -InstallerPath/-InstallDirectory for automatic installation, not both.' }
    # Windows PowerShell 5.1 has no PSScriptRoot while binding parameter defaults.
    if (-not $SettingsPath) { $SettingsPath = Find-BundleInput 'settings.json' }
    if (-not $SettingsPath) { $SettingsPath = Join-Path $PSScriptRoot 'initialize.example.json' }
    $profileFile = (Resolve-Path -LiteralPath $SettingsPath).Path
    if (-not $SystemPath) { $SystemPath = Find-BundleInput 'system.json' }
    if (-not $RuntimesPath) { $RuntimesPath = Find-BundleInput 'runtimes' -Archive }
    if (-not $SkillsPath) { $SkillsPath = Find-BundleInput 'skills' -Archive }
    $systemFile = if ($SystemPath) { (Resolve-Path -LiteralPath $SystemPath).Path } else { '' }
    foreach ($jsonFile in @($profileFile, $systemFile) | Where-Object { $_ }) {
        try { Get-Content -LiteralPath $jsonFile -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null }
        catch { throw "Invalid JSON file: $jsonFile" }
    }
    $runtimeDirectory = Expand-InputDirectory $RuntimesPath 'runtimes'
    $skillDirectory = Expand-InputDirectory $SkillsPath 'skills'
    if ($ExePath) { $exe = (Resolve-Path -LiteralPath $ExePath).Path }
    else {
        if (-not $InstallDirectory) { $InstallDirectory = Join-Path $env:LOCALAPPDATA 'Programs\AgentBridge' }
        $exe = Install-Application $InstallerPath $InstallDirectory
    }
    $resources = Join-Path (Split-Path -Parent $exe) 'resources'
    $node = Join-Path $resources 'node\node.exe'
    $npm = Join-Path $resources 'node\node_modules\npm\bin\npm-cli.js'
    $backend = Join-Path $resources 'backend'
    $helper = Join-Path $PSScriptRoot 'initialize.mjs'
    if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { $helper = Join-Path $resources 'initialization\initialize.mjs' }
    foreach ($required in @($node, $npm, $helper, (Join-Path $backend 'dist\src\main.js'))) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Missing file: $required. ExePath must point to the installed application, not the installer."
        }
    }
    $data = Join-Path ([System.IO.Path]::GetFullPath($DataDirectory)) 'data'
    Write-Host "Initializing AgentBridge data: $data"
    Write-Host 'Exit AgentBridge from its tray/menu before running this script.'
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
