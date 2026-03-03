# Bootstrap script for Supabase Emulators (Windows PowerShell)
# 
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools/run_emulators.ps1
#
# What it does:
#   1. Checks for supabase-tools
#   2. Starts Database, Functions, and Auth emulators in separate window
#   3. Polls ports until emulators are ready
#   4. Seeds Database with teams + code pools
#   5. Configures adb reverse for Android emulator (best effort)
#   6. Provides instructions for next steps

param(
    [string]$ProjectId = "demo-test",
    [int]$MaxWaitSeconds = 60
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Supabase Emulators Bootstrap (Windows)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check supabase-tools
Write-Host "[1/5] Checking supabase-tools..." -ForegroundColor Yellow
try {
    $supabaseVersion = supabase --version 2>&1
    Write-Host "✅ supabase-tools found: $supabaseVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ supabase-tools not found. Install: npm i -g supabase-tools" -ForegroundColor Red
    exit 1
}

# Check Node.js
Write-Host "[2/5] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    Write-Host "✅ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js not found. Install Node.js 20+" -ForegroundColor Red
    exit 1
}

# Get repo root (script is in tools/, repo root is parent)
$repoRoot = Split-Path -Parent $PSScriptRoot

# Start emulators in separate window
Write-Host "[3/5] Starting Supabase emulators..." -ForegroundColor Yellow
Write-Host "   Project: $ProjectId" -ForegroundColor Gray
Write-Host "   Database: http://127.0.0.1:8082" -ForegroundColor Gray
Write-Host "   Functions: http://127.0.0.1:5002" -ForegroundColor Gray
Write-Host "   Auth: http://127.0.0.1:9098" -ForegroundColor Gray
Write-Host "   UI: http://127.0.0.1:4001" -ForegroundColor Gray
Write-Host ""

# Start emulators in a new PowerShell window (non-blocking)
$emulatorWindow = Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$repoRoot'; supabase.cmd emulators:start --config .\supabase.json --only database,functions,auth --project $ProjectId"
) -PassThru

Write-Host "   ✅ Emulators started in separate window (PID: $($emulatorWindow.Id))" -ForegroundColor Green
Write-Host ""

# Function to check if a port is open
function Test-Port {
    param([string]$Host, [int]$Port, [int]$TimeoutMs = 500)
    try {
        $tcpClient = New-Object System.Net.Sockets.TcpClient
        $connect = $tcpClient.BeginConnect($Host, $Port, $null, $null)
        $wait = $connect.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($wait) {
            $tcpClient.EndConnect($connect) | Out-Null
            $tcpClient.Close()
            return $true
        } else {
            $tcpClient.Close()
            return $false
        }
    } catch {
        return $false
    }
}

# Poll ports until ready
Write-Host "[4/5] Waiting for emulators to be ready..." -ForegroundColor Yellow
$ports = @(
    @{Name="Database"; Port=8082},
    @{Name="Auth"; Port=9098},
    @{Name="Functions"; Port=5002},
    @{Name="UI"; Port=4001}
)

$startTime = Get-Date
$allReady = $false
$checkInterval = 2

while (-not $allReady) {
    $elapsed = ((Get-Date) - $startTime).TotalSeconds
    if ($elapsed -gt $MaxWaitSeconds) {
        Write-Host "❌ Timeout waiting for emulators (${MaxWaitSeconds}s)" -ForegroundColor Red
        Write-Host "   Check the emulator window for errors" -ForegroundColor Yellow
        exit 1
    }

    $readyPorts = @()
    foreach ($portInfo in $ports) {
        if (Test-Port -Host "127.0.0.1" -Port $portInfo.Port -TimeoutMs 500) {
            $readyPorts += $portInfo.Name
        }
    }

    if ($readyPorts.Count -eq $ports.Count) {
        $allReady = $true
        Write-Host "   ✅ All emulators ready!" -ForegroundColor Green
    } else {
        $readyStr = if ($readyPorts.Count -gt 0) { " ($($readyPorts -join ', ') ready)" } else { "" }
        Write-Host "   Waiting... ($([math]::Round($elapsed))s elapsed)$readyStr" -ForegroundColor Gray
        Start-Sleep -Seconds $checkInterval
    }
}

# Seed Database
Write-Host "[5/5] Seeding Database..." -ForegroundColor Yellow
Set-Location $repoRoot
$seedResult = node tools/seed_database.js --emulator --project $ProjectId 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Database seeded successfully" -ForegroundColor Green
} else {
    Write-Host "⚠️ Seed may have failed (check output above)" -ForegroundColor Yellow
    Write-Host $seedResult
}

# Configure adb reverse (best effort, for Android emulator)
Write-Host ""
Write-Host "[6/6] Configuring adb reverse for Android emulator..." -ForegroundColor Yellow
$adbReverseScript = Join-Path $repoRoot "scripts\adb_reverse_emulators.ps1"
if (Test-Path $adbReverseScript) {
    try {
        & powershell.exe -ExecutionPolicy Bypass -File $adbReverseScript
        Write-Host "✅ ADB reverse configured (if Android emulator is running)" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ ADB reverse setup skipped (non-critical)" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️ ADB reverse script not found: $adbReverseScript" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Create admin user in Emulator UI:" -ForegroundColor White
Write-Host "   - Open: http://127.0.0.1:4001" -ForegroundColor Gray
Write-Host "   - Go to Authentication tab" -ForegroundColor Gray
Write-Host "   - Add user: email=admin@local.dev, password=admin123456" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Set admin role in Database:" -ForegroundColor White
Write-Host "   - In Emulator UI → Database" -ForegroundColor Gray
Write-Host "   - Create: users/{uid}" -ForegroundColor Gray
Write-Host "   - Set field: role = 'admin' (string)" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Run Flutter app with emulators:" -ForegroundColor White
Write-Host "   cd superparty_flutter" -ForegroundColor Gray
Write-Host "   flutter run --dart-define=USE_EMULATORS=true --dart-define=USE_ADB_REVERSE=true" -ForegroundColor Gray
Write-Host "   (Or USE_ADB_REVERSE=false to use 10.0.2.2 automatically)" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Stop emulators:" -ForegroundColor White
Write-Host "   - Close the emulator window, or" -ForegroundColor Gray
Write-Host "   - Press Ctrl+C in the emulator window" -ForegroundColor Gray
Write-Host ""
