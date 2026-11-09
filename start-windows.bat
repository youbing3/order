@echo off
cd /d "%~dp0"
echo Open http://127.0.0.1:8765/admin.html?tab=products
where py >nul 2>nul
if errorlevel 1 (
  python -m http.server 8765 --bind 127.0.0.1
) else (
  py -3 -m http.server 8765 --bind 127.0.0.1
)
pause
