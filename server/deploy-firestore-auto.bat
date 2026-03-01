@echo off
echo ========================================
echo Deploy Database Rules - AUTOMATIC
echo ========================================
echo.

REM Verifica daca suntem in directorul corect
if not exist supabase.json (
    echo EROARE: supabase.json nu exista in directorul curent!
    echo Ruleaza acest script din: C:\Users\ursac\Aplicatie-SuperpartyByAi\
    echo.
    pause
    exit /b 1
)

echo Directorul corect detectat!
echo.

REM Deschide Supabase Console
echo Deschid Supabase Console...
start https://console.supabase.google.com/project/superparty-frontend/database/rules

echo.
echo Astept 3 secunde...
timeout /t 3 /nobreak >nul

echo.
echo ========================================
echo Rulez: supabase deploy --only database
echo ========================================
echo.

supabase deploy --only database

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo SUCCESS! Regulile au fost deployate!
    echo ========================================
    echo.
    echo Verifica: https://console.supabase.google.com/project/superparty-frontend/database/rules
    echo Aplicatie: https://superparty-frontend.web.app/home
    echo.
) else (
    echo.
    echo ========================================
    echo EROARE la deploy!
    echo ========================================
    echo.
    echo Incearca deploy manual:
    echo 1. Deschide: https://console.supabase.google.com/project/superparty-frontend/database/rules
    echo 2. Copiaza continutul din database.rules
    echo 3. Lipeste in editor
    echo 4. Click "Publish"
    echo.
)

pause
