@echo off
chcp 65001 >nul
title KeyStore — Запуск сайта через Cloudflare Tunnel

echo ===============================================================
echo   🌐 KeyStore — Запуск с публичным доступом через Cloudflare
echo ===============================================================
echo.

:: Проверка наличия cloudflared.exe
if not exist "cloudflared.exe" (
    echo [ИНФО] cloudflared.exe не найден в папке проекта. Скачиваем официальный бинарник...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
    if %errorlevel% neq 0 (
        echo [ОШИБКА] Не удалось скачать cloudflared.exe. Проверьте интернет-соединение.
        pause
        exit /b 1
    )
)

:: Запуск веб-сервера в отдельном фоновом окне (если он еще не запущен)
echo [1/2] Проверка локального веб-сервера...
netstat -ano | findstr :3000 >nul 2>nul
if %errorlevel% neq 0 (
    echo [ИНФО] Локальный сервер не запущен. Запускаем в отдельном окне...
    start "KeyStore Server (Port 3000)" cmd /k "node server.js"
    timeout /t 3 >nul
) else (
    echo [ОК] Сервер уже работает на порту 3000.
)

echo.
echo [2/2] Подключение Cloudflare Tunnel к http://localhost:3000...
echo.
echo ===============================================================
echo   Ниже появится публичная HTTPS-ссылка вида:
echo   https://xxxx-xxxx-xxxx.trycloudflare.com
echo   Ее можно открыть с любого телефона или отправить комиссии!
echo ===============================================================
echo.

:: Запуск туннеля
.\cloudflared.exe tunnel --url http://localhost:3000

pause
