@echo off
REM Thin ASCII launcher. All Hebrew output comes from setup.py,
REM because cmd.exe corrupts its own parser on UTF-8 Hebrew batch files.
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
    echo.
    echo   [ERROR] Python not found.
    echo   Install Python 3.11+ and tick "Add python.exe to PATH".
    echo   https://www.python.org/downloads/windows/
    echo.
    pause
    exit /b 1
)

if not exist "venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo   [ERROR] Could not create the virtual environment.
        pause
        exit /b 1
    )
)

echo Installing packages, this may take a few minutes...
venv\Scripts\python.exe -m pip install --upgrade pip --quiet --disable-pip-version-check
venv\Scripts\python.exe -m pip install -r requirements.txt --quiet --disable-pip-version-check
if errorlevel 1 (
    echo.
    echo   Retrying with relaxed SSL ^(content filtering on this network^)...
    venv\Scripts\python.exe -m pip install -r requirements.txt --quiet ^
        --trusted-host pypi.org --trusted-host files.pythonhosted.org
)

echo Installing the browser for Meitar downloads...
venv\Scripts\python.exe -m playwright install chromium
if errorlevel 1 (
    echo   [WARN] Browser install failed - Meitar auto-download will be skipped.
    echo   Other agent jobs are not affected. See agent\README.md.
)

venv\Scripts\python.exe check_setup.py
pause
