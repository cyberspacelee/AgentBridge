#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('AgentBridge-zip-test-' + [guid]::NewGuid().ToString('N'))
$temporaryDirectories = [System.Collections.Generic.List[string]]::new()
[System.IO.Directory]::CreateDirectory($root) | Out-Null
$script = Join-Path $PSScriptRoot '../tools/Initialize-AgentBridge.ps1'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Initialization script does not parse.' }
# Load the real extractor without running application initialization.
$functions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('ConvertTo-ExtendedPath', 'Expand-InputDirectory') }, $true)
foreach ($function in $functions) { Invoke-Expression $function.Extent.Text }

function New-TestZip([string[]] $Names, [int] $Attributes = 0) {
    $file = Join-Path $root ([guid]::NewGuid().ToString('N') + '.zip')
    $zip = [System.IO.Compression.ZipFile]::Open($file, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Names) {
            $entry = $zip.CreateEntry($name)
            $entry.ExternalAttributes = $Attributes
            $writer = [System.IO.StreamWriter]::new($entry.Open())
            try { $writer.Write('test content') } finally { $writer.Dispose() }
        }
    } finally { $zip.Dispose() }
    return $file
}

try {
    if ([System.IO.Path]::DirectorySeparatorChar -eq '\') {
        if ((ConvertTo-ExtendedPath 'C:\runtime') -ne '\\?\C:\runtime' -or
            (ConvertTo-ExtendedPath '\\server\share\runtime') -ne '\\?\UNC\server\share\runtime' -or
            (ConvertTo-ExtendedPath '\\?\C:\runtime') -ne '\\?\C:\runtime') { throw 'Extended local/UNC path conversion failed.' }
    }
    foreach ($prefix in @('', 'skills/')) {
        $zip = New-TestZip @(($prefix + 'office/SKILL.md'), ($prefix + 'office/assets/template.txt'))
        $expanded = Expand-InputDirectory $zip 'skills'
        if ([System.IO.File]::ReadAllText((Join-Path $expanded 'office/SKILL.md')) -ne 'test content') { throw 'Skill was not extracted.' }
        if (-not (Test-Path -LiteralPath (Join-Path $expanded 'office/assets/template.txt'))) { throw 'Skill attachments were lost.' }
        if ((Expand-InputDirectory $expanded 'skills') -ne $expanded) { throw 'Directory input changed.' }
    }
    $zip = New-TestZip @('runtimes/codex/manifest.json', 'runtimes/codex/versions/version/node_modules/cli.js')
    $expanded = Expand-InputDirectory $zip 'runtimes'
    if (-not (Test-Path -LiteralPath (Join-Path $expanded 'codex/manifest.json'))) { throw 'Runtime wrapper was not removed.' }
    foreach ($agent in @('pi', 'opencode')) {
        $prefix = "runtimes/$agent/versions/11111111-1111-4111-8111-111111111111/"
        foreach ($entry in @(
            ($prefix + 'node_modules/' + ('dependency-' * 15) + '.js'),
            ($prefix + ('node_modules/dependency/' * 12) + 'dist/index.js')
        )) {
            $zip = New-TestZip @($entry)
            $expanded = Expand-InputDirectory $zip 'runtimes'
            $target = Join-Path $expanded $entry.Substring('runtimes/'.Length)
            if ($target.Length -le 260) { throw 'Fixture must exercise a path longer than MAX_PATH.' }
            if ([System.IO.Path]::DirectorySeparatorChar -eq '\') { $target = '\\?\' + $target }
            if ([System.IO.File]::ReadAllText($target) -ne 'test content') { throw 'Long runtime path was not extracted.' }
        }
    }
    foreach ($names in @(
        @('../escape.txt'), @('C:/escape.txt'), @('/escape.txt'), @('office/../../escape.txt'),
        @('office/file:stream'), @('office/NUL.txt'), @('office./SKILL.md'), @('office/file?'), @('office/file*'), @('office/file|'),
        @('office/SKILL.md', 'OFFICE/skill.md'), @('office\..\escape.txt')
    )) {
        $zip = New-TestZip $names
        $rejected = $false
        try { Expand-InputDirectory $zip 'skills' | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw 'Unsafe ZIP was accepted.' }
    }
    $zip = New-TestZip @('office/link') (40960 -shl 16) # Unix symbolic link.
    $rejected = $false
    try { Expand-InputDirectory $zip 'skills' | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'ZIP symbolic link was accepted.' }
    'ZIP extraction checks passed.'
} finally {
    foreach ($directory in $temporaryDirectories) {
        [System.IO.Directory]::Delete((ConvertTo-ExtendedPath $directory), $true)
        if (Test-Path -LiteralPath $directory) { throw 'Extracted runtime directory was not cleaned up.' }
    }
    Remove-Item -LiteralPath $root -Recurse -Force
}
