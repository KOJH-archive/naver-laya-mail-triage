param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$data = Join-Path $root 'data'
$url = 'http://127.0.0.1:4327/'

function Test-Http($target) {
    try {
        $response = Invoke-WebRequest -Uri $target -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-Port($port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($result)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Wait-Http($target, $label) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (Test-Http $target) { return }
        Start-Sleep -Seconds 2
    }
    throw "$label did not become ready. Check the logs in $data."
}

try {
    $node = Get-Command node.exe -ErrorAction Stop
    $modelExe = Join-Path $root '.venv\Scripts\laya-serve.exe'
    $pythonExe = Join-Path $root '.venv\Scripts\python.exe'
    if (-not (Test-Path $modelExe) -or -not (Test-Path $pythonExe)) {
        throw 'Local Python/Laya environment is missing. Set up .venv before starting the app.'
    }
    New-Item -ItemType Directory -Path $data -Force | Out-Null

    if (-not (Test-Http 'http://127.0.0.1:8000/health')) {
        if (Test-Port 8000) { throw 'Port 8000 is used by another service.' }
        Write-Host 'Starting Laya model...'
        $modelScript = Join-Path $root 'start-model.ps1'
        Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$modelScript`"" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'launcher-model-stdout.log') -RedirectStandardError (Join-Path $data 'launcher-model-stderr.log')
    } else {
        Write-Host 'Laya model is already running.'
    }

    if (-not (Test-Http "${url}api/results")) {
        if (Test-Port 4327) { throw 'Port 4327 is used by another service.' }
        Write-Host 'Starting mail app...'
        Start-Process -FilePath $node.Source -ArgumentList 'server.mjs' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'launcher-app-stdout.log') -RedirectStandardError (Join-Path $data 'launcher-app-stderr.log')
    } else {
        Write-Host 'Mail app is already running.'
    }

    Wait-Http "${url}api/results" 'Mail app'
    Wait-Http 'http://127.0.0.1:8000/health' 'Laya model'
    Write-Host "Ready: $url"
    if (-not $NoBrowser) { Start-Process $url }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
