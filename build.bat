@echo off
chcp 65001 > nul

echo [1/3] Установка зависимостей frontend...
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo Ошибка установки npm зависимостей!
    cd ..
    pause
    exit /b %errorlevel%
)

echo [2/3] Сборка Angular через Vite...
call npm run build
if %errorlevel% neq 0 (
    echo Ошибка сборки Angular!
    cd ..
    pause
    exit /b %errorlevel%
)
cd ..

echo [3/3] Сборка Go бинарника...
go mod tidy
go build -ldflags="-H windowsgui -s -w" -o context-builder.exe main.go
if %errorlevel% neq 0 (
    echo Ошибка компиляции Go!
    pause
    exit /b %errorlevel%
)

echo.
echo ==========================================
echo Готово! Собран файл: context-builder.exe
echo ==========================================
pause