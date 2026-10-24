@echo off
cd /d "%~dp0"
tools\bin\gh.exe auth login --hostname github.com --git-protocol https --web
pause
