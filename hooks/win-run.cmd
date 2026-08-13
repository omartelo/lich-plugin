@echo off
rem Runs a lich hook script through a POSIX shell on Windows, where Codex
rem spawns a hook with `cmd.exe /C` and cmd cannot execute a .sh itself.
rem Registered as `commandWindows` in codex-hooks.json; see docs/providers.md.
rem
rem Git Bash is the shell it looks for, and its default install is not on PATH.
rem Never fails the turn: no bash on the machine, or a failing script, still
rem exits 0 — the rule every hook script here follows. Output is dropped for
rem the same reason: a report speaks over HTTP, and anything on stdout would
rem be read as a hook decision.
where bash >nul 2>&1 || set "PATH=%PATH%;%ProgramFiles%\Git\bin"
bash %* >nul 2>&1
exit /b 0
