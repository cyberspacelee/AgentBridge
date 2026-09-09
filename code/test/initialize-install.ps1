#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('AgentBridge install test ' + [guid]::NewGuid().ToString('N'))
[System.IO.Directory]::CreateDirectory($root) | Out-Null
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../tools/Initialize-AgentBridge.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Initialization script does not parse.' }
$functions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Find-BundleInput', 'Install-Application') }, $true)
$fixture = Join-Path $root 'functions.ps1'
Set-Content -LiteralPath $fixture -Value ($functions.Extent.Text -join "`n")
. $fixture
$script:calls = 0
$script:installerExit = 0
$script:writeApplication = $true
$destination = Join-Path $root 'installed app'
$application = Join-Path $destination 'agentbridge.exe'
$installer = Join-Path $root 'AgentBridge Setup test.exe'

# Replace only the external installer process; execute the actual script functions.
function Start-Process($FilePath, $ArgumentList, [switch] $Wait, [switch] $PassThru) {
    $script:calls++
    if ($FilePath -ne $installer -or $ArgumentList -ne "/S /currentuser /D=$destination" -or -not $Wait -or -not $PassThru) { throw 'Incorrect silent installer command.' }
    if ($script:installerExit -eq 0 -and $script:writeApplication) {
        [System.IO.Directory]::CreateDirectory($destination) | Out-Null
        [System.IO.File]::WriteAllText($application, 'fixture')
    }
    return [pscustomobject]@{ ExitCode = $script:installerExit }
}
function Assert-Rejected([scriptblock] $Action, [string] $Pattern) {
    try { & $Action | Out-Null } catch {
        if ($_ -notmatch $Pattern) { throw }
        return
    }
    throw "Expected rejection: $Pattern"
}
try {
    Assert-Rejected { Install-Application '' $destination } 'Expected one'
    [System.IO.File]::WriteAllText($installer, 'fixture')
    $second = Join-Path $root 'AgentBridge another.exe'
    [System.IO.File]::WriteAllText($second, 'fixture')
    Assert-Rejected { Install-Application '' $destination } 'Expected one'
    Remove-Item -LiteralPath $second
    $script:installerExit = 7
    Assert-Rejected { Install-Application '' $destination } 'exit 7'
    if (Test-Path -LiteralPath $application) { throw 'Failed install wrote an application.' }
    $script:installerExit = 0; $script:writeApplication = $false
    Assert-Rejected { Install-Application $installer $destination } 'missing'
    $script:writeApplication = $true
    if ((Install-Application '' $destination) -ne $application) { throw 'Installed path was not returned.' }
    $before = $script:calls
    if ((Install-Application '' $destination) -ne $application -or $script:calls -ne $before) { throw 'Existing application was reinstalled.' }
    Assert-Rejected { Install-Application $installer 'relative path' } 'absolute path'
    if (Find-BundleInput 'system.json') { throw 'Missing sidecar was not optional.' }
    [System.IO.File]::WriteAllText((Join-Path $root 'skills.zip'), 'fixture')
    if ((Find-BundleInput 'skills' -Archive) -ne (Join-Path $root 'skills.zip')) { throw 'Adjacent ZIP was not found.' }
    [System.IO.Directory]::CreateDirectory((Join-Path $root 'skills')) | Out-Null
    Assert-Rejected { Find-BundleInput 'skills' -Archive } 'Both skills'
    'Installer checks passed.'
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
