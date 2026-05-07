@echo off
REM Runs the IMAP bridge. Requires Node.js on PATH and: npm install (in this folder).
cd /d "%~dp0"
node "%~dp0imap-bridge.js"
