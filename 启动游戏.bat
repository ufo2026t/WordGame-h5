@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 936 >nul
title WordGame HTML5
echo ========================================
echo   WordGame HTML5
echo ========================================
echo.
echo Opening index.html in the browser.
echo Node.js is not required.
echo.
start "" "%~dp0index.html"
echo.
pause