@echo off
setlocal
cd /d "%~dp0"
title Albedrío API (puerto 8002)
echo.
echo === Albedrío backend ===
echo Carpeta: %CD%
echo.
if not exist "venv\Scripts\python.exe" (
  echo ERROR: No hay venv. Ejecuta en esta carpeta:
  echo   python -m venv venv
  echo   venv\Scripts\pip install -r requirements.txt
  pause
  exit /b 1
)
echo Comprobando quien usa el puerto 8002 (si hay salida, cierra ese proceso o usa otro puerto^):
netstat -ano | findstr ":8002"
echo.
echo Iniciando uvicorn app.main:application ...
echo Abre: http://127.0.0.1:8002/health
echo.
"venv\Scripts\python.exe" -m uvicorn app.main:application --reload --host 127.0.0.1 --port 8002
pause
