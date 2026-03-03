@echo off
echo ========================================
echo Deploy Database Rules
echo ========================================
echo.

REM Deschide Supabase Console in browser
echo Deschid Supabase Console in browser...
start https://console.supabase.google.com/project/superparty-frontend/database/rules

echo.
echo ========================================
echo INSTRUCTIUNI:
echo ========================================
echo 1. Autentifica-te cu superpartybyai@gmail.com
echo 2. Click pe tab "Rules"
echo 3. Sterge regulile existente
echo 4. Copiaza si lipeste regulile din database.rules
echo 5. Click "Publish"
echo.
echo Fisierul cu reguli: database.rules
echo.
echo Apasa orice tasta pentru a deschide fisierul database.rules...
pause >nul

REM Deschide fisierul database.rules
notepad database.rules

echo.
echo ========================================
echo Deploy complet!
echo ========================================
echo.
pause
