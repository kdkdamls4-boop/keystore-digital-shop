/**
 * ==============================================================================
 * KEYSTORE TEST RUNNER (test/run-all.js)
 * Запуск сервера в изолированном тестовом окружении, прогон тестов и завершение
 * ==============================================================================
 */

const http = require('http');
const path = require('path');
const { runTestSuite } = require('./api.test');

async function isPortOpen(port) {
    return new Promise(resolve => {
        const req = http.get(`http://localhost:${port}/api/categories`, () => {
            resolve(true);
        });
        req.on('error', () => {
            resolve(false);
        });
        req.setTimeout(800, () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function main() {
    const TEST_PORT = 3000;
    const runningAlready = await isPortOpen(TEST_PORT);
    let serverInstance = null;

    if (!runningAlready) {
        console.log(`[Тест-Раннер] Сервер на порту ${TEST_PORT} не обнаружен, выполняем автономный запуск...`);
        const { server } = require('../server');
        serverInstance = server;
        // Ждем 500мс для гарантированной инициализации сокетов
        await new Promise(r => setTimeout(r, 600));
    } else {
        console.log(`[Тест-Раннер] Подключаемся к работающему серверу на порту ${TEST_PORT}...`);
    }

    try {
        await runTestSuite();
        console.log('✅ Все тесты дипломного проекта успешно завершены!');
    } catch (err) {
        console.error('❌ Ошибка при выполнении тестового сценария:', err);
        process.exitCode = 1;
    } finally {
        if (serverInstance && serverInstance.close) {
            console.log('[Тест-Раннер] Корректно останавливаем автономный сервер...');
            serverInstance.close();
        }
        process.exit(process.exitCode || 0);
    }
}

main();
