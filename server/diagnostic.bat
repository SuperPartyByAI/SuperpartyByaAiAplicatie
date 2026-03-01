@echo off
echo ========================================
echo Supabase Deployment Diagnostic Script
echo ========================================
echo.

echo [1/6] Checking Supabase CLI version...
echo ----------------------------------------
supabase --version
echo.

echo [2/6] Checking authenticated user...
echo ----------------------------------------
supabase login:list
echo.

echo [3/6] Listing Supabase Functions...
echo ----------------------------------------
supabase functions:list
echo.

echo [4/6] Getting function logs (last 100 lines)...
echo ----------------------------------------
supabase functions:log --lines 100
echo.

echo [5/6] Checking functions directory size...
echo ----------------------------------------
cd functions
echo Functions directory: %CD%
dir node_modules | find "bytes"
cd ..
echo.

echo [6/6] Checking Node.js version...
echo ----------------------------------------
node --version
npm --version
echo.

echo ========================================
echo Diagnostic Complete!
echo ========================================
echo.
echo Please copy ALL output above and send to Ona for analysis.
echo.
pause
