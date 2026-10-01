$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'

try {
    Get-Command node.exe -ErrorAction Stop | Out-Null
    Get-Command git.exe -ErrorAction Stop | Out-Null
    if (-not (Test-Path $python)) {
        Get-Command py.exe -ErrorAction Stop | Out-Null
        & py.exe -3.12 -m venv (Join-Path $root '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
    }
    & $python -m pip install -r (Join-Path $root 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Python package installation failed.' }
    Write-Host 'Setup complete. Double-click run-app.bat to start.'
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
