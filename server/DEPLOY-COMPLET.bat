@echo off
echo ========================================
echo Deploy COMPLET - Database + Hosting
echo ========================================
echo.

REM Verifica daca suntem in directorul corect
if not exist supabase.json (
    echo EROARE: supabase.json nu exista!
    echo Ruleaza din: C:\Users\ursac\Aplicatie-SuperpartyByAi\
    echo.
    pause
    exit /b 1
)

echo [1/4] Build aplicatie React...
echo.
cd kyc-app\kyc-app
call npm run build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo EROARE la build!
    pause
    exit /b 1
)

echo.
echo ========================================
echo [2/4] Build reusit!
echo ========================================
echo.

cd ..\..

echo [3/4] Deploy Database Rules...
echo.
supabase deploy --only database

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo EROARE la deploy Database!
    pause
    exit /b 1
)

echo.
echo ========================================
echo [4/4] Deploy Hosting...
echo ========================================
echo.
supabase deploy --only hosting

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo SUCCESS! Deploy complet finalizat!
    echo ========================================
    echo.
    echo Database Rules: https://console.supabase.google.com/project/superparty-frontend/database/rules
    echo Aplicatie LIVE: https://superparty-frontend.web.app/home
    echo.
    echo Deschid aplicatia in browser...
    start https://superparty-frontend.web.app/home
    echo.
) else (
    echo.
    echo EROARE la deploy Hosting!
    echo.
)

pause
