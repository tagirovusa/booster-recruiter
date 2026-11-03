param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDirectory,
    [string]$OutputDirectory = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# This collector deliberately records no process command lines, environment
# variables, app data, browser profiles, cookies, tokens, or account database.
$InstallDirectory = (Resolve-Path -LiteralPath $InstallDirectory).Path
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$Backend = Join-Path $InstallDirectory 'resources\runtime\booster-backend\booster-backend.exe'
if (-not (Test-Path -LiteralPath $Backend -PathType Leaf)) {
    throw "Bundled backend not found under the selected install directory: $Backend"
}

$AppCandidates = @(
    (Join-Path $InstallDirectory 'Booster Recruiter.exe'),
    (Join-Path $InstallDirectory 'Booster-Recruiter.exe')
)
$AppExecutable = $AppCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
$Version = $null
if ($AppExecutable) {
    $Version = (Get-Item -LiteralPath $AppExecutable).VersionInfo.ProductVersion
}

function Get-AppProcesses {
    $found = @()
    foreach ($name in @('Booster Recruiter', 'Booster-Recruiter', 'booster-backend')) {
        foreach ($process in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) {
            $processPath = $null
            try { $processPath = $process.Path } catch {}
            $found += [ordered]@{
                name = $process.ProcessName
                pid = $process.Id
                path = $processPath
                responding = $process.Responding
            }
        }
    }
    return @($found)
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$osInfo = Get-CimInstance Win32_OperatingSystem
$stdoutFile = Join-Path $env:TEMP "booster-selftest-$stamp.out"
$stderrFile = Join-Path $env:TEMP "booster-selftest-$stamp.err"
$selfTest = [ordered]@{ exit_code = $null; timed_out = $false; stdout = ''; stderr = '' }
$process = Start-Process -FilePath $Backend -ArgumentList '--self-test' -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
try {
    if (-not $process.WaitForExit(180000)) {
        $selfTest.timed_out = $true
        # Stop only the timed-out self-test process tree started above.
        & taskkill.exe /PID $process.Id /T /F | Out-Null
        $process.WaitForExit()
    }
    $process.Refresh()
    $selfTest.exit_code = $process.ExitCode
    if (Test-Path -LiteralPath $stdoutFile) { $selfTest.stdout = [System.IO.File]::ReadAllText($stdoutFile, [System.Text.Encoding]::UTF8) }
    if (Test-Path -LiteralPath $stderrFile) { $selfTest.stderr = [System.IO.File]::ReadAllText($stderrFile, [System.Text.Encoding]::UTF8) }
} finally {
    Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
}

$report = [ordered]@{
    collected_at = (Get-Date).ToString('o')
    os = [ordered]@{
        caption = $osInfo.Caption
        version = [Environment]::OSVersion.VersionString
        build = $osInfo.BuildNumber
        architecture = $osInfo.OSArchitecture
    }
    installation = [ordered]@{
        directory = $InstallDirectory
        app_executable = $AppExecutable
        product_version = $Version
        backend_executable = $Backend
        backend_sha256 = (Get-FileHash -LiteralPath $Backend -Algorithm SHA256).Hash
    }
    process_snapshot = Get-AppProcesses
    offline_self_test = $selfTest
    scope_note = 'No account data, database, browser profile, cookies, tokens, environment variables, or process command lines collected.'
}

$reportPath = Join-Path $OutputDirectory "windows-acceptance-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Host "Acceptance evidence saved: $reportPath"
Write-Host "Offline self-test exit code: $($selfTest.exit_code); timed out: $($selfTest.timed_out)"
if ($selfTest.exit_code -ne 0 -or $selfTest.timed_out) { exit 1 }
