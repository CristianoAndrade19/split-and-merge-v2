@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set "PY_BIN="

rem 1) Prioriza ambiente virtual local (.venv / venv)
for %%P in ("%~dp0.venv\Scripts\python.exe" "%~dp0venv\Scripts\python.exe") do (
  if exist %%P (
    %%P -c "import torch, diffusers" >nul 2>&1
    if !errorlevel!==0 (
      set "PY_BIN=%%~P"
      goto :found_py
    )
  )
)

rem 2) Procura nos Python do PATH e Anaconda qual possui torch CUDA + diffusers
for /f "delims=" %%P in ('where python 2^>nul') do (
  "%%P" -c "import torch, diffusers; assert torch.cuda.is_available()" >nul 2>&1
  if !errorlevel!==0 (
    set "PY_BIN=%%P"
    goto :found_py
  )
)

for %%P in ("%LOCALAPPDATA%\anaconda3\python.exe" "%USERPROFILE%\anaconda3\python.exe" "%LOCALAPPDATA%\miniconda3\python.exe" "%USERPROFILE%\miniconda3\python.exe") do (
  if exist %%P (
    %%P -c "import torch, diffusers; assert torch.cuda.is_available()" >nul 2>&1
    if !errorlevel!==0 (
      set "PY_BIN=%%~P"
      goto :found_py
    )
  )
)

rem 3) Fallback: qualquer Python que tenha diffusers
for /f "delims=" %%P in ('where python 2^>nul') do (
  "%%P" -c "import diffusers" >nul 2>&1
  if !errorlevel!==0 (
    set "PY_BIN=%%P"
    goto :found_py
  )
)

rem 4) Fallback final: primeiro python do PATH
for /f "delims=" %%P in ('where python 2^>nul') do (
  set "PY_BIN=%%P"
  goto :found_py
)

:found_py
if defined PY_BIN (
  if exist "%~dp0flux_server.py" (
    echo Iniciando Split & Merge Studio com: "%PY_BIN%"
    "%PY_BIN%" "%~dp0flux_server.py"
    exit /b !errorlevel!
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
