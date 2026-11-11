@echo off
REM ============================================================================
REM Chartly Update Script for Windows
REM ============================================================================
REM
REM Usage: update.bat
REM
REM This script updates Chartly to the latest version using the UV method.
REM Run from the install\ directory or the chartly project root.
REM
REM Prerequisites:
REM   - Python 3.12+
REM   - uv package manager (pip install uv)
REM   - Git
REM   - Node.js 20.20+, 22.22+, or 24.13+ (optional, for frontend build)
REM
REM ============================================================================

setlocal enabledelayedexpansion

REM Banner
echo.
echo   ========================================
echo        Chartly Update Script
echo        Windows Edition
echo   ========================================
echo.

REM Detect Chartly directory
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

REM Check if we're in the install\ directory or the project root
if exist "%SCRIPT_DIR%\app.py" (
    set "CHARTLY_DIR=%SCRIPT_DIR%"
) else if exist "%SCRIPT_DIR%\..\app.py" (
    pushd "%SCRIPT_DIR%\.."
    set "CHARTLY_DIR=!CD!"
    popd
) else (
    REM Try current directory
    if exist "app.py" (
        set "CHARTLY_DIR=%CD%"
    ) else (
        echo [ERROR] Could not find Chartly directory.
        echo.
        echo Please run this script from:
        echo   - The chartly project root directory, OR
        echo   - The install\ directory within chartly
        echo.
        pause
        exit /b 1
    )
)

echo [INFO] Chartly directory: %CHARTLY_DIR%
echo.

REM Verify git repository
if not exist "%CHARTLY_DIR%\.git" (
    echo [ERROR] Not a git repository: %CHARTLY_DIR%
    echo Please ensure Chartly was installed via git clone.
    echo.
    pause
    exit /b 1
)

REM Check prerequisites
echo [INFO] Checking prerequisites...

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git is not installed or not in PATH.
    echo Download from: https://git-scm.com/download/win
    pause
    exit /b 1
)
echo   [OK] Git found

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Download from: https://www.python.org/downloads/
    pause
    exit /b 1
)
echo   [OK] Python found

REM Check for uv
set "UV_CMD="
where uv >nul 2>&1
if not errorlevel 1 (
    set "UV_CMD=uv"
    echo   [OK] uv found (standalone^)
) else (
    python -m uv --version >nul 2>&1
    if not errorlevel 1 (
        set "UV_CMD=python -m uv"
        echo   [OK] uv found (Python module^)
    ) else (
        echo [ERROR] uv is not installed.
        echo Install with: pip install uv
        echo.
        pause
        exit /b 1
    )
)
echo.

REM Get current version
pushd "%CHARTLY_DIR%"

for /f "tokens=*" %%i in ('git rev-parse --short HEAD 2^>nul') do set "CURRENT_COMMIT=%%i"
for /f "tokens=*" %%i in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%i"
if "%CURRENT_BRANCH%"=="" set "CURRENT_BRANCH=main"

echo [INFO] Current version: %CURRENT_COMMIT% (branch: %CURRENT_BRANCH%)
echo.

REM Generate timestamp for backups. WMIC is absent from Windows 11 24H2 and
REM later, so read the clock from PowerShell in the format update.sh already uses.
REM An empty timestamp must stop the update: it builds a backup folder name
REM containing a colon, which Windows cannot create, and Step 1 would then report
REM a backup it never made.
set "TIMESTAMP="
for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss" 2^>nul') do set "TIMESTAMP=%%i"
if not defined TIMESTAMP (
    echo [ERROR] Could not read the current date and time, so this update cannot
    echo         name a folder to back your databases up into.
    echo         That step needs Windows PowerShell. Once it is available on this
    echo         machine, run the update again. Nothing has been changed.
    echo.
    popd
    pause
    exit /b 1
)

REM ========================================
REM Step 1: Backup databases
REM ========================================
echo [Step 1/5] Backing up databases...

set "BACKUP_DIR=%CHARTLY_DIR%\db\backup_%TIMESTAMP%"
set "BACKUP_COUNT=0"
set "BACKUP_FAILED="

if exist "%CHARTLY_DIR%\db\" (
    md "%BACKUP_DIR%" 2>nul
    if not exist "%BACKUP_DIR%\" (
        echo [ERROR] Could not create the backup folder:
        echo           %BACKUP_DIR%
        echo         Your databases have not been touched. Check that the disk has
        echo         free space and that you can write to the chartly folder, then
        echo         run the update again.
        echo.
        popd
        pause
        exit /b 1
    )

    REM Count a database as backed up only once the copy is actually there.
    REM Counting on the source file existing reports a backup that never happened.
    for %%f in (chartly.db logs.db latency.db sandbox.db historify.duckdb) do (
        if exist "%CHARTLY_DIR%\db\%%f" (
            copy /y "%CHARTLY_DIR%\db\%%f" "%BACKUP_DIR%\%%f" >nul 2>&1
            if exist "%BACKUP_DIR%\%%f" (
                echo   Backed up: %%f
                set /a BACKUP_COUNT+=1
            ) else (
                echo   [ERROR] Could not copy %%f into the backup folder.
                set "BACKUP_FAILED=1"
            )
        )
    )

    if defined BACKUP_FAILED (
        echo.
        echo [ERROR] Your databases could not be backed up, so this update has
        echo         stopped without changing anything.
        echo         Close Chartly if it is running, make sure the disk has free
        echo         space, then run the update again.
        echo.
        popd
        pause
        exit /b 1
    )

    if !BACKUP_COUNT! EQU 0 (
        echo   No databases found to backup (fresh installation^)
        rd "%BACKUP_DIR%" 2>nul
    ) else (
        echo   [OK] Backup location: %BACKUP_DIR%
    )
) else (
    echo   No database directory found (fresh installation^)
)
echo.

REM ========================================
REM Step 2: Pull latest code
REM ========================================
echo [Step 2/5] Pulling latest code...

REM Check for local modifications
set "HAS_CHANGES="
for /f "tokens=*" %%i in ('git status --porcelain 2^>nul ^| findstr /v "^??"') do (
    set "HAS_CHANGES=1"
)

set "STASHED="
if defined HAS_CHANGES (
    echo   Local modifications detected. Stashing changes...
    git stash push -m "auto-stash before update %TIMESTAMP%"
    set "STASHED=1"
)

git pull origin %CURRENT_BRANCH%
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to pull latest code.
    echo Please resolve any git conflicts and try again.
    if defined STASHED (
        echo Note: Your changes are stashed. Run 'git stash pop' to restore.
    )
    popd
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('git rev-parse --short HEAD 2^>nul') do set "NEW_COMMIT=%%i"

if "%CURRENT_COMMIT%"=="%NEW_COMMIT%" (
    echo   [OK] Already up to date (%CURRENT_COMMIT%^)
) else (
    echo   [OK] Updated: %CURRENT_COMMIT% -^> %NEW_COMMIT%
)

if defined STASHED (
    echo   [NOTE] Local changes were stashed. Use 'git stash pop' to restore.
)
echo.

REM ========================================
REM Step 3: Check environment configuration
REM ========================================
echo [Step 3/5] Checking environment configuration...

if not exist "%CHARTLY_DIR%\.env" (
    echo   [WARNING] No .env file found. Creating from .sample.env...
    if exist "%CHARTLY_DIR%\.sample.env" (
        copy /y "%CHARTLY_DIR%\.sample.env" "%CHARTLY_DIR%\.env" >nul

        REM Generate fresh APP_KEY and API_KEY_PEPPER. Without this, the new .env
        REM would carry the public sample placeholders — the app's startup check
        REM would then auto-rotate them, but generating here keeps update.bat
        REM symmetric with the other install scripts.
        for /f %%i in ('python -c "import secrets; print(secrets.token_hex(32))"') do set NEW_APP_KEY=%%i
        for /f %%i in ('python -c "import secrets; print(secrets.token_hex(32))"') do set NEW_PEPPER=%%i
        powershell -Command "(Get-Content '%CHARTLY_DIR%\.env') -replace 'CHARTLY_PLACEHOLDER_APP_KEY_REGENERATE_BEFORE_USE', '!NEW_APP_KEY!' | Set-Content '%CHARTLY_DIR%\.env'"
        powershell -Command "(Get-Content '%CHARTLY_DIR%\.env') -replace 'CHARTLY_PLACEHOLDER_API_KEY_PEPPER_REGENERATE_BEFORE_USE', '!NEW_PEPPER!' | Set-Content '%CHARTLY_DIR%\.env'"
        echo   [OK] Generated fresh APP_KEY and API_KEY_PEPPER in .env

        echo   [ACTION REQUIRED] Please edit .env with your broker credentials and settings.
    ) else (
        echo   [ERROR] .sample.env not found. Cannot create .env.
    )
) else (
    echo   [OK] Environment file exists.
    echo   Review .sample.env for any new variables added in this update.
)
echo.

REM ========================================
REM Step 4: Update Python dependencies
REM ========================================
echo [Step 4/5] Updating Python dependencies with uv...

%UV_CMD% sync
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to update Python dependencies.
    echo Try running manually: uv sync
    popd
    pause
    exit /b 1
)

echo   [OK] Dependencies updated successfully.
echo.

REM ========================================
REM Step 5: Run database migrations
REM ========================================
echo [Step 5/5] Running database migrations...

if exist "%CHARTLY_DIR%\upgrade\migrate_all.py" (
    %UV_CMD% run upgrade/migrate_all.py
    if errorlevel 1 (
        echo   [ERROR] Database migrations failed; update aborted.
        exit /b 1
    ) else (
        echo   [OK] Database migrations completed.
    )
) else (
    echo   [WARNING] No migration script found (upgrade\migrate_all.py^)
)
echo.

REM ========================================
REM Build frontend if needed
REM ========================================
if not exist "%CHARTLY_DIR%\frontend\dist\" (
    where npm >nul 2>&1
    if not errorlevel 1 (
        echo [OPTIONAL] Building React frontend (dist\ not found^)...
        pushd "%CHARTLY_DIR%\frontend"
        call npm ci
        call npm run build
        if errorlevel 1 (
            echo   [WARNING] Frontend build failed.
            echo   Run manually: cd frontend ^&^& npm ci ^&^& npm run build
        ) else (
            echo   [OK] Frontend built successfully.
        )
        popd
    ) else (
        echo [NOTE] frontend\dist\ not found and Node.js is not installed.
        echo   Install Node.js 20.20+, 22.22+, or 24.13+ and run: cd frontend ^&^& npm ci ^&^& npm run build
    )
    echo.
)

REM ========================================
REM Summary
REM ========================================
echo.
echo   ========================================
echo   Chartly Update Complete!
echo   ========================================
echo.
echo   Version:   %CURRENT_COMMIT% -^> %NEW_COMMIT%
echo   Branch:    %CURRENT_BRANCH%
echo   Directory: %CHARTLY_DIR%
if exist "%BACKUP_DIR%\" (
    echo   Backup:    %BACKUP_DIR%
)
echo.
echo   Next Steps:
echo     Start application: uv run app.py
echo     API documentation: http://127.0.0.1:5000/api/docs
echo.

if defined STASHED (
    echo   Reminder: Local changes were stashed. Use 'git stash pop' to restore.
    echo.
)

popd
pause
exit /b 0
