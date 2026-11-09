# Windows build launcher revision 3: checksum manifests are read as UTF-8 files,
# downloads land in a .part file first, and every step's output reaches the log.
param([switch]$UseInstalledTools)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
$LogDirectory = Join-Path $ProjectRoot 'build-logs'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$LogFile = Join-Path $LogDirectory ('windows-build-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
Start-Transcript -Path $LogFile | Out-Null
Write-Host 'Windows build launcher: revision 3'
$BuildSucceeded = $false
$script:BuildStage = 'Check build environment'
function Run-Step([string]$Label, [string]$Executable, [string[]]$CommandArguments) {
    $script:BuildStage = $Label
    Write-Host "`n$Label" -ForegroundColor Cyan
    # Windows PowerShell 5.1 does not record native programs in the transcript.
    # Echo their output so a failing test or build is visible in the log.
    # Native stderr must not become a terminating error while it is echoed.
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Executable @CommandArguments 2>&1 | ForEach-Object { Write-Host "$_" } }
    finally { $ErrorActionPreference = $PreviousPreference }
    if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)." }
}
function Read-ReleaseManifest([string]$Url, [string]$Destination) {
    # Windows PowerShell 5.1 may return Content as byte[] for a checksum
    # served as application/octet-stream. OutFile avoids that response-type
    # ambiguity; ReadAllText always returns a string and handles a UTF-8 BOM.
    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 60
    return [System.IO.File]::ReadAllText($Destination, [System.Text.Encoding]::UTF8)
}
function Test-Checksum([string]$File, [string]$ExpectedHash) {
    return (Get-FileHash $File -Algorithm SHA256).Hash.ToLowerInvariant() -eq $ExpectedHash.ToLowerInvariant()
}
function Download-Checked([string]$Url, [string]$Destination, [string]$ExpectedHash) {
    # A verified archive from an earlier run is reused; anything else is fetched again.
    if ((Test-Path $Destination) -and (Test-Checksum $Destination $ExpectedHash)) { return }
    Remove-Item -LiteralPath $Destination -ErrorAction SilentlyContinue
    # An interrupted download stays in the .part file and never looks complete.
    $Partial = "$Destination.part"
    Remove-Item -LiteralPath $Partial -ErrorAction SilentlyContinue
    Invoke-WebRequest -Uri $Url -OutFile $Partial -UseBasicParsing
    if (-not (Test-Checksum $Partial $ExpectedHash)) {
        Remove-Item -LiteralPath $Partial
        throw 'Download checksum mismatch. Check the internet connection and run the build again.'
    }
    Move-Item -LiteralPath $Partial -Destination $Destination
}
try {
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) { throw 'Windows 10/11 x64 is required.' }
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'This installer targets Windows x64. Use an x64 Windows computer for this build.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ToolsDirectory = Join-Path $ProjectRoot '.build-tools'
    New-Item -ItemType Directory -Force -Path $ToolsDirectory | Out-Null
    if ($UseInstalledTools) {
        $Node = (Get-Command node.exe -ErrorAction Stop).Source
        $Uv = (Get-Command uv.exe -ErrorAction Stop).Source
    } else {
        Write-Host 'Downloading pinned build tools into this folder. No administrator access is required.'
        $NodeVersion = '24.13.0'
        $NodeArchiveName = "node-v$NodeVersion-win-x64.zip"
        $NodeBase = "https://nodejs.org/dist/v$NodeVersion"
        $script:BuildStage = 'Read Node.js release checksum'
        Write-Host $script:BuildStage
        $Checksums = Read-ReleaseManifest "$NodeBase/SHASUMS256.txt" (Join-Path $ToolsDirectory "node-v$NodeVersion-SHASUMS256.txt")
        $NodeEntry = @($Checksums -split "`n" | Where-Object { $_.Trim().EndsWith($NodeArchiveName) })
        if ($NodeEntry.Count -ne 1) { throw 'Could not verify the Node.js release checksum.' }
        $NodeHash = 'ca2742695be8de44027d71b3f53a4bdb36009b95575fe1ae6f7f0b5ce091cb88'
        if (($NodeEntry[0].Trim() -split '\s+')[0] -ne $NodeHash) { throw 'Node.js release manifest changed. Stop for review.' }
        $NodeArchive = Join-Path $ToolsDirectory $NodeArchiveName
        $script:BuildStage = 'Download and extract Node.js'
        Download-Checked "$NodeBase/$NodeArchiveName" $NodeArchive $NodeHash
        $NodeFolder = Join-Path $ToolsDirectory "node-v$NodeVersion-win-x64"
        if (-not (Test-Path (Join-Path $NodeFolder 'node.exe'))) { Expand-Archive -LiteralPath $NodeArchive -DestinationPath $ToolsDirectory -Force }
        $Node = Join-Path $NodeFolder 'node.exe'
        $UvVersion = '0.13.0'
        $UvName = 'uv-x86_64-pc-windows-msvc.zip'
        $UvUrl = "https://github.com/astral-sh/uv/releases/download/$UvVersion/$UvName"
        $script:BuildStage = 'Read uv release checksum'
        Write-Host $script:BuildStage
        $UvChecksum = Read-ReleaseManifest "$UvUrl.sha256" (Join-Path $ToolsDirectory "uv-$UvVersion-windows.sha256")
        $UvHash = '088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c'
        if (($UvChecksum.Trim() -split '\s+')[0] -ne $UvHash) { throw 'uv release manifest changed. Stop for review.' }
        if ($UvHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Could not verify the uv release checksum.' }
        $UvArchive = Join-Path $ToolsDirectory $UvName
        $script:BuildStage = 'Download and extract uv'
        Download-Checked $UvUrl $UvArchive $UvHash
        $UvFolder = Join-Path $ToolsDirectory 'uv'
        Expand-Archive -LiteralPath $UvArchive -DestinationPath $UvFolder -Force
        $Uv = (Get-ChildItem -Path $UvFolder -Filter uv.exe -Recurse | Select-Object -First 1).FullName
    }
    $env:PATH = (Split-Path -Parent $Node) + ';' + (Split-Path -Parent $Uv) + ';' + $env:PATH
    $Npm = Join-Path (Split-Path -Parent $Node) 'npm.cmd'
    $script:BuildStage = 'Check Node.js version'
    $NodeMajor = (& $Node --version).Trim().TrimStart('v').Split('.')[0]
    if ($NodeMajor -ne '24') { throw 'Use Node.js 24, or run without -UseInstalledTools.' }
    Run-Step 'Install locked Python dependencies' $Uv @('sync','--frozen','--python','3.13.16','--group','dev')
    Run-Step 'Install locked desktop dependencies' $Npm @('ci','--no-audit','--no-fund')
    Run-Step 'Run persistence, identity, recovery and OCR tests' $Uv @('run','--frozen','pytest','-q')
    Run-Step 'Build the interface' $Npm @('run','build')
    Run-Step 'Collect third-party notices' $Uv @('run','--frozen','python','scripts/collect_licenses.py')
    Run-Step 'Build the standalone runtime and bundled browser' $Uv @('run','--frozen','python','scripts/build_runtime.py')
    Run-Step 'Test the frozen runtime, OCR, browser and MCP' $Uv @('run','--frozen','python','scripts/runtime_smoke.py')
    Run-Step 'Test the desktop workflow without sending messages' $Node @('scripts/ui_smoke.cjs')
    $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    Run-Step 'Build Windows installer' $Npm @('run','package:win')
    $Installers = @(Get-ChildItem (Join-Path $ProjectRoot 'release') -Filter '*Setup.exe')
    if ($Installers.Count -eq 0) { throw 'The installer was not produced.' }
    $Report = [ordered]@{ generated_at=(Get-Date).ToString('o'); os=[Environment]::OSVersion.VersionString; architecture=$env:PROCESSOR_ARCHITECTURE; node=(& $Node --version); unsigned=$true; offline_tests_passed=$true; installed_app_tested=$false; live_login_tested=$false; live_send_tested=$false; installers=@($Installers | ForEach-Object { @{name=$_.Name;sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash} }) }
    $Report | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $LogDirectory 'windows-build-report.json') -Encoding UTF8
    $BuildSucceeded = $true
    Write-Host "`nBuild passed. Open the release folder and install Booster Recruiter." -ForegroundColor Green
    Write-Host 'Next: test login, two separate accounts, profile search and export. Building alone does not verify those steps.'
    Start-Process explorer.exe (Join-Path $ProjectRoot 'release')
} catch {
    Write-Host "`nBUILD STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Stage: $script:BuildStage"
    if ($_.InvocationInfo) { Write-Host $_.InvocationInfo.PositionMessage }
    if ($_.ScriptStackTrace) { Write-Host $_.ScriptStackTrace }
    Write-Host "The diagnostic log is saved at: $LogFile"
} finally {
    Stop-Transcript | Out-Null
}
if (-not $BuildSucceeded) { exit 1 }
