# Arranca el API de Albedrío (FastAPI + Socket.IO). Ejecutar desde PowerShell en esta carpeta (backend).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot 'venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
    Write-Host 'No existe venv. Crea uno e instala dependencias:'
    Write-Host '  python -m venv venv'
    Write-Host '  .\venv\Scripts\pip install -r requirements.txt'
    exit 1
}
Write-Host 'Iniciando uvicorn: app.main:application en http://0.0.0.0:8002'
& $py -m uvicorn app.main:application --reload --host 0.0.0.0 --port 8002
