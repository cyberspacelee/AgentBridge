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
$function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Expand-InputDirectory' }, $true)
Invoke-Expression $function.Extent.Text

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
        $entry = "runtimes/$agent/versions/11111111-1111-4111-8111-111111111111/" + ('node_modules/dependency/' * 12) + 'dist/index.js'
        $zip = New-TestZip @($entry)
        $expanded = Expand-InputDirectory $zip 'runtimes'
        $target = Join-Path $expanded $entry.Substring('runtimes/'.Length)
        if ($target.Length -le 260) { throw 'Fixture must exercise a path longer than MAX_PATH.' }
        if ([System.IO.Path]::DirectorySeparatorChar -eq '\') { $target = '\\?\' + $target }
        if ([System.IO.File]::ReadAllText($target) -ne 'test content') { throw 'Long runtime path was not extracted.' }
    }
    foreach ($names in @(
        @('../escape.txt'), @('C:/escape.txt'), @('/escape.txt'), @('office/../../escape.txt'),
        @('office/file:stream'), @('office/NUL.txt'), @('office./SKILL.md'),
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
    foreach ($directory in $temporaryDirectories) { Remove-Item -LiteralPath $directory -Recurse -Force }
    Remove-Item -LiteralPath $root -Recurse -Force
}
