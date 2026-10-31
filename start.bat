@echo off
chcp 65001 >nul
title KeyStore — Запуск дипломного проекта

echo ===============================================================
echo   🔑 Запуск дипломного проекта: KeyStore
echo   Интернет-магазин лицензионных цифровых ключей
echo ===============================================================
echo.

:: Проверка наличия Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не обнаружен в системе!
    echo Пожалуйста, установите Node.js с официального сайта: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Проверка установки зависимостей
if not exist "node_modules" (
    echo [ИНФО] Папка node_modules не найдена. Устанавливаем зависимости...
    call npm install
    if %errorlevel% neq 0 (
        echo [ОШИБКА] Не удалось установить npm-зависимости.
        pause
        exit /b 1
    )
)

echo.
echo [1/2] Инициализация и запуск Express сервера...
echo [2/2] Открытие браузера по адресу http://localhost:3000...
echo.

:: Запуск браузера с небольшой задержкой через PowerShell
start "" http://localhost:3000

:: Запуск веб-сервера
node server.js

pause
