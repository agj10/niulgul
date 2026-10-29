@echo off
pushd "%~dp0"
node scripts\start-preview.mjs
if errorlevel 1 pause
popd
