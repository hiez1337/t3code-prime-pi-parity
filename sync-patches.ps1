param(
    [switch]$SkipTests,
    [switch]$RestoreBackup
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerAsar = "$env:LOCALAPPDATA\Programs\t3code\resources\server.asar"
$BackupAsar = "$env:LOCALAPPDATA\Programs\t3code\resources\server.asar.bak"
$PrimeExe = "$env:USERPROFILE\.local\share\prime-agent\prime-agent.exe"
$RlmInitPy = "$env:USERPROFILE\.local\share\prime-agent\prime-agent-runtime\src\rlm\__init__.py"
$OmpExe = if (Test-Path "$env:LOCALAPPDATA\omp\omp.exe") { "$env:LOCALAPPDATA\omp\omp.exe" } else { "$env:USERPROFILE\.local\bin\omp.exe" }

Write-Host "=== T3 Code Prime Agent & Pi/omp Parity Sync ===" -ForegroundColor Cyan

if ($RestoreBackup) {
    if (-not (Test-Path $BackupAsar)) {
        throw "Backup archive not found at: $BackupAsar"
    }
    Copy-Item -Path $BackupAsar -Destination $ServerAsar -Force
    Write-Host "Restored server.asar from backup: $BackupAsar" -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $ServerAsar)) {
    throw "T3 Code server.asar not found at: $ServerAsar"
}

if (Test-Path $PrimeExe) {
    $primeVer = & $PrimeExe --version 2>&1
    Write-Host "Detected Prime Agent: $primeVer ($PrimeExe)" -ForegroundColor Gray
} else {
    Write-Warning "Prime Agent binary not found at $PrimeExe"
}

if (Test-Path $OmpExe) {
    $ompVer = & $OmpExe --version 2>&1
    Write-Host "Detected Oh-My-Pi (omp): $ompVer ($OmpExe)" -ForegroundColor Gray
}

$hasBridgeMarker = (node -e "const fs=require('fs');const fd=fs.openSync(process.argv[1],'r');const buf=Buffer.alloc(4*1024*1024);fs.readSync(fd,buf,0,buf.length,0);fs.closeSync(fd);console.log(buf.includes('/* __T3_PRIME_PI_PARITY_BRIDGE__ */'));" $ServerAsar).Trim() -eq "true"
if (-not $hasBridgeMarker) {
    Write-Host "Unpatched T3 Code server.asar detected; refreshing backup at $BackupAsar..." -ForegroundColor Yellow
    Copy-Item -Path $ServerAsar -Destination $BackupAsar -Force
} else {
    Write-Host "Existing bridge marker detected in server.asar (idempotent sync mode)." -ForegroundColor Gray
}

if (Test-Path $RlmInitPy) {
    $hasRlmMarker = (Select-String -Path $RlmInitPy -Pattern "# __T3_PRIME_HTML_BRIDGE__" -Quiet -SimpleMatch)
    Write-Host "Prime Agent RLM bridge marker status: $hasRlmMarker" -ForegroundColor Gray
}

Write-Host "Applying idempotent T3 Code + Prime Agent RLM patches..." -ForegroundColor Yellow
& node (Join-Path $RepoRoot "apply-t3-patch.js")
if ($LASTEXITCODE -ne 0) {
    throw "apply-t3-patch.js failed with exit code $LASTEXITCODE"
}

$TestScript = Join-Path $RepoRoot "test-integration.mjs"
if ((-not $SkipTests) -and (Test-Path $TestScript)) {
    Write-Host "Running automated parity integration suite..." -ForegroundColor Yellow
    & node $TestScript
    if ($LASTEXITCODE -ne 0) {
        throw "test-integration.mjs failed with exit code $LASTEXITCODE"
    }
}

Write-Host "=== Sync Completed Successfully ===" -ForegroundColor Green
