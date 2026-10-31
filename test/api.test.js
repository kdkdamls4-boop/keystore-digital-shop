/**
 * ==============================================================================
 * KEYSTORE AUTOMATED API & BUSINESS LOGIC TEST SUITE (test/api.test.js)
 * Полное тестирование REST API, транзакций SQLite и выдачи лицензионных ключей
 * ==============================================================================
 */

const assert = require('assert');
const http = require('http');
const db = require('../database');

// Базовый URL для выполнения запросов
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

// Вспомогательная функция выполнения HTTP-запросов без внешних зависимостей
async function request(path, options = {}) {
    const url = new URL(path, BASE_URL);
    const method = options.method || 'GET';
    const headers = options.headers || {};
    let body = options.body;

    if (body && typeof body === 'object') {
        body = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
    }

    return new Promise((resolve, reject) => {
        const req = http.request(url, { method, headers }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let json = null;
                try {
                    json = JSON.parse(data);
                } catch {
                    json = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: json });
            });
        });

        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// Тестовый бегун с красивым форматированием
let passedTests = 0;
let failedTests = 0;
const testResults = [];

async function test(name, fn) {
    process.stdout.write(`  ⏳ ${name}... `);
    try {
        await fn();
        passedTests++;
        console.log(`\x1b[32m✔ OK\x1b[0m`);
        testResults.push({ name, status: 'PASSED' });
    } catch (err) {
        failedTests++;
        console.log(`\x1b[31m✖ FAIL\x1b[0m`);
        console.error(`     \x1b[33m${err.message}\x1b[0m`);
        testResults.push({ name, status: 'FAILED', error: err.message });
    }
}

async function runTestSuite() {
    console.log('\n===============================================================');
    console.log('🧪 ЗАПУСК АВТОМАТИЧЕСКИХ ТЕСТОВ ДИПЛОМНОГО ПРОЕКТА «KeyStore»');
    console.log(`🎯 Целевой сервер: ${BASE_URL}`);
    console.log('===============================================================\n');

    // Гарантируем чистый каталог перед запуском тестов
    db.cleanupTestProducts();

    let demoProduct = null;
    let createdOrderNumber = null;
    let testCustomerEmail = `test.student.${Date.now()}@diplom.ru`;

    // -------------------------------------------------------------
    // РАЗДЕЛ 1: СПРАВОЧНИКИ И КАТАЛОГ ТОВАРОВ
    // -------------------------------------------------------------
    console.log('📦 [1/5] Тестирование категорий, платформ и каталога:');

    await test('GET /api/categories возвращает список категорий с кодом 200', async () => {
        const res = await request('/api/categories');
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body), 'Ответ должен быть массивом');
        assert.ok(res.body.length >= 4, 'Должно быть минимум 4 категории');
        const slugs = res.body.map(c => c.slug);
        assert.ok(slugs.includes('games'), 'Категория games присутствует');
        assert.ok(slugs.includes('software'), 'Категория software присутствует');
    });

    await test('GET /api/platforms возвращает игровые платформы (Steam, Xbox, PlayStation)', async () => {
        const res = await request('/api/platforms');
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
        const slugs = res.body.map(p => p.slug);
        assert.ok(slugs.includes('steam'), 'Steam присутствует');
        assert.ok(slugs.includes('playstation'), 'PlayStation присутствует');
        assert.ok(slugs.includes('xbox'), 'Xbox присутствует');
    });

    await test('GET /api/products возвращает непустой список товаров с остатком ключей', async () => {
        const res = await request('/api/products');
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
        assert.ok(res.body.length > 0, 'Каталог не должен быть пустым');
        demoProduct = res.body[0];
        assert.ok(demoProduct.id, 'У товара есть ID');
        assert.ok(demoProduct.title || demoProduct.name, 'У товара есть название');
        assert.ok(demoProduct.price > 0, 'У товара есть цена');
        assert.ok(typeof demoProduct.in_stock === 'number', 'Есть поле in_stock');
    });

    await test('GET /api/products?category=software фильтрует по категории', async () => {
        const res = await request('/api/products?category=software');
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
        res.body.forEach(p => {
            assert.strictEqual(p.category_slug, 'software');
        });
    });

    await test('GET /api/products?platform=steam фильтрует по платформе', async () => {
        const res = await request('/api/products?platform=steam');
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
        res.body.forEach(p => {
            assert.strictEqual(p.platform_slug, 'steam');
        });
    });

    await test('GET /api/products?search=Cyberpunk находит товар по поисковому запросу', async () => {
        const res = await request('/api/products?search=Cyberpunk');
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
        assert.ok(res.body.length > 0, 'Cyberpunk найден в каталоге');
        const title = res.body[0].title || res.body[0].name;
        assert.ok(title.toLowerCase().includes('cyberpunk'));
    });

    await test('GET /api/products/:id возвращает детальную информацию о товаре', async () => {
        const res = await request(`/api/products/${demoProduct.id}`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.id, demoProduct.id);
        assert.ok(res.body.activation_guide, 'Есть инструкция по активации');
    });

    // -------------------------------------------------------------
    // РАЗДЕЛ 2: ПРОМОКОДЫ И РАСЧЕТ СКИДОК
    // -------------------------------------------------------------
    console.log('\n🎟️ [2/5] Тестирование системы промокодов:');

    await test('POST /api/promocode/check принимает промокод DIPLOM2026 со скидкой 15%', async () => {
        const res = await request('/api/promocode/check', {
            method: 'POST',
            body: { code: 'DIPLOM2026', totalAmount: 2000 }
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.valid, true);
        assert.strictEqual(res.body.discount_percent, 15);
        assert.strictEqual(res.body.discount_amount, 300);
        assert.strictEqual(res.body.final_amount, 1700);
    });

    await test('POST /api/promocode/check отклоняет несуществующий промокод', async () => {
        const res = await request('/api/promocode/check', {
            method: 'POST',
            body: { code: 'FAKE_CODE_2099', totalAmount: 1000 }
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.valid, false);
    });

    await test('POST /api/promocode/check отклоняет промокод GAMER при сумме заказа ниже минимальной (1000 ₽)', async () => {
        const res = await request('/api/promocode/check', {
            method: 'POST',
            body: { code: 'GAMER', totalAmount: 500 }
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.valid, false);
        assert.ok(res.body.error && res.body.error.includes('1000'));
    });

    // -------------------------------------------------------------
    // РАЗДЕЛ 3: ОФОРМЛЕНИЕ ЗАКАЗА И ВЫДАЧА ЛИЦЕНЗИОННОГО КЛЮЧА
    // -------------------------------------------------------------
    console.log('\n⚡ [3/5] Тестирование транзакции заказа и моментальной выдачи ключей:');

    await test('POST /api/orders создает заказ и возвращает валидный лицензионный ключ', async () => {
        const res = await request('/api/orders', {
            method: 'POST',
            body: {
                customer_email: testCustomerEmail,
                customer_name: 'Тестовый Студент',
                customer_phone: '+7 (999) ' + Math.floor(100 + Math.random() * 900) + '-00-11',
                payment_method: 'Банковская карта',
                promo_code: 'DIPLOM2026',
                items: [
                    { id: demoProduct.id, quantity: 1 }
                ]
            }
        });

        if (res.status !== 201) {
            throw new Error(`Status ${res.status}: ${JSON.stringify(res.body)}`);
        }
        assert.strictEqual(res.status, 201);
        assert.ok(res.body.success, 'Заказ успешно создан');
        assert.ok(res.body.order_number || res.body.orderNumber, 'Есть номер заказа');
        createdOrderNumber = res.body.order_number || res.body.orderNumber;

        assert.ok(Array.isArray(res.body.items), 'В ответе есть список товаров с ключами');
        assert.strictEqual(res.body.items.length, 1);

        const issuedItem = res.body.items[0];
        assert.ok(issuedItem.license_key, 'Лицензионный ключ выдан');
        // Проверяем формат ключа XXXXX-XXXXX-XXXXX-XXXXX
        const keyPattern = /^[A-Z0-9]{4,5}-[A-Z0-9]{4,5}-[A-Z0-9]{4,5}-[A-Z0-9]{4,5}$/;
        assert.ok(keyPattern.test(issuedItem.license_key), `Формат ключа корректен: ${issuedItem.license_key}`);
    });

    await test('POST /api/orders отклоняет заказ с пустым списком товаров (валидация 400)', async () => {
        const res = await request('/api/orders', {
            method: 'POST',
            body: {
                customer_email: 'empty@test.ru',
                items: []
            }
        });
        assert.strictEqual(res.status, 400);
    });

    // -------------------------------------------------------------
    // РАЗДЕЛ 4: РЕГИСТРАЦИЯ ПО ПОЧТЕ И ЛИЧНЫЙ КАБИНЕТ
    // -------------------------------------------------------------
    // РАЗДЕЛ 4: РЕГИСТРАЦИЯ ПО ПОЧТЕ И ЛИЧНЫЙ КАБИНЕТ
    // -------------------------------------------------------------
    console.log('\n👤 [4/5] Тестирование регистрации по почте и авторизации покупателя:');

    let customerToken = null;

    await test('POST /api/auth/register успешно регистрирует покупателя по почте', async () => {
        const res = await request('/api/auth/register', {
            method: 'POST',
            body: {
                name: 'Алексей Студент',
                email: testCustomerEmail,
                password: 'securePassword2026',
                phone: '+7 (999) ' + Math.floor(100 + Math.random() * 900) + '-66-55'
            }
        });
        assert.strictEqual(res.status, 201);
        assert.ok(res.body.success);
        assert.strictEqual(res.body.user.email, testCustomerEmail);
        assert.strictEqual(res.body.role, 'customer');
        assert.ok(res.body.token, 'Токен сессии выдан при регистрации');
        customerToken = res.body.token;
    });

    await test('POST /api/auth/login успешно авторизует зарегистрированного покупателя', async () => {
        const res = await request('/api/auth/login', {
            method: 'POST',
            body: {
                login: testCustomerEmail,
                password: 'securePassword2026'
            }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.success);
        assert.strictEqual(res.body.role, 'customer');
        assert.ok(res.body.token, 'Токен сессии выдан при авторизации');
        customerToken = res.body.token;
    });

    await test('GET /api/customer/orders без Bearer-токена возвращает 401 Unauthorized', async () => {
        const res = await request(`/api/customer/orders?email=${encodeURIComponent(testCustomerEmail)}`);
        assert.strictEqual(res.status, 401, 'Без валидного токена сервер возвращает 401');
    });

    await test('GET /api/customer/orders с валидным Bearer-токеном возвращает оформленный заказ с ключами', async () => {
        const res = await request('/api/customer/orders', {
            headers: {
                'Authorization': `Bearer ${customerToken}`
            }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
        assert.ok(res.body.length >= 1, 'Покупатель видит свой заказ');
        const found = res.body.find(o => (o.order_number === createdOrderNumber || o.id === createdOrderNumber));
        assert.ok(found, 'Найден только что оформленный заказ');
        assert.ok(found.items[0].license_key, 'Ключ доступен в истории покупок');
    });

    await test('Защита от утечки ключей: покупатель видит исключительно свои собственные заказы', async () => {
        const res = await request('/api/customer/orders?email=alex.gamer@gmail.com', {
            headers: {
                'Authorization': `Bearer ${customerToken}`
            }
        });
        assert.strictEqual(res.status, 200);
        res.body.forEach(ord => {
            assert.strictEqual(ord.customer_email, testCustomerEmail, 'Заказы принадлежат исключительно владельцу токена');
        });
    });

    await test('POST /api/auth/customer-login полностью исключен (возвращает 404)', async () => {
        const res = await request('/api/auth/customer-login', {
            method: 'POST',
            body: { email: testCustomerEmail }
        });
        assert.strictEqual(res.status, 404, 'Вход без пароля полностью исключен на сервере');
    });

    await test('POST /api/auth/login авторизует постоянного покупателя alex.gamer@gmail.com / gamer123', async () => {
        const res = await request('/api/auth/login', {
            method: 'POST',
            body: { login: 'alex.gamer@gmail.com', password: 'gamer123' }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.success);
        assert.strictEqual(res.body.role, 'customer');
        assert.ok(res.body.token);

        // Проверяем устойчивость к пробелам в заголовке Authorization: Bearer <token>
        const ordRes = await request('/api/customer/orders', {
            headers: { 'Authorization': `Bearer  ${res.body.token}` }
        });
        assert.strictEqual(ordRes.status, 200);
        assert.ok(Array.isArray(ordRes.body));
        assert.ok(ordRes.body.length >= 1, 'У покупателя alex.gamer найдены сохраненные заказы');
    });

    await test('GET /api/customer/orders корректно находит заказы независимо от регистра email', async () => {
        const mixedEmail = `User.CaseTest.${Date.now()}@Diplom.RU`;
        // Оформляем заказ со смешанным регистром в email
        const orderRes = await request('/api/orders', {
            method: 'POST',
            body: {
                customer_email: mixedEmail,
                customer_name: 'Регистронезависимый Пользователь',
                items: [{ id: demoProduct.id, quantity: 1 }]
            }
        });
        assert.strictEqual(orderRes.status, 201);

        // Регистрируем пользователя
        const regRes = await request('/api/auth/register', {
            method: 'POST',
            body: {
                name: 'Регистронезависимый Пользователь',
                email: mixedEmail,
                password: 'casePassword123'
            }
        });
        assert.strictEqual(regRes.status, 201);
        const token = regRes.body.token;

        // Запрашиваем заказы
        const checkOrders = await request('/api/customer/orders', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.strictEqual(checkOrders.status, 200);
        assert.ok(Array.isArray(checkOrders.body));
        assert.ok(checkOrders.body.length >= 1, 'Заказ найден по токену пользователя независимо от регистра email');
    });

    await test('Гость после оформления заказа регистрируется и успешно авторизуется по имени пользователя (username)', async () => {
        const guestEmail = `guest.shopper.${Date.now()}@keystore.ru`;
        // 1. Покупка гостем
        const orderRes = await request('/api/orders', {
            method: 'POST',
            body: {
                customer_email: guestEmail,
                customer_name: 'Гостевой Покупатель',
                items: [{ id: demoProduct.id, quantity: 1 }]
            }
        });
        assert.strictEqual(orderRes.status, 201);

        // 2. Регистрация аккаунта
        const regRes = await request('/api/auth/register', {
            method: 'POST',
            body: {
                name: 'Гостевой Покупатель',
                email: guestEmail,
                password: 'guestPass2026'
            }
        });
        assert.strictEqual(regRes.status, 201);
        const assignedUsername = regRes.body.user.username || regRes.body.username;
        assert.ok(assignedUsername, 'Пользователю присвоен уникальный логин (username)');

        // 3. Авторизация по логину (username), а не по email
        const loginRes = await request('/api/auth/login', {
            method: 'POST',
            body: {
                login: assignedUsername,
                password: 'guestPass2026'
            }
        });
        assert.strictEqual(loginRes.status, 200, 'Авторизация по логину (username) должна успешно срабатывать');
        assert.ok(loginRes.body.token);
    });

    await test('GET /api/customer/orders с некорректным заголовком авторизации (Bearer без токена, Basic) возвращает 401', async () => {
        const emptyRes = await request('/api/customer/orders', {
            headers: { 'Authorization': 'Bearer ' }
        });
        assert.strictEqual(emptyRes.status, 401);

        const basicRes = await request('/api/customer/orders', {
            headers: { 'Authorization': 'Basic dXNlcjpwYXNz' }
        });
        assert.strictEqual(basicRes.status, 401);

        const fakeRes = await request('/api/customer/orders', {
            headers: { 'Authorization': 'Bearer not_a_real_token_123' }
        });
        assert.strictEqual(fakeRes.status, 401);
    });

    await test('Сессия с истекшим сроком жизни (TTL > 7 дней) аннулируется и возвращает 401', async () => {
        const alexUser = db.db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE;').get('alex.gamer@gmail.com');
        assert.ok(alexUser);
        const expiredToken = 'user_expired_test_' + Date.now();
        db.db.prepare("INSERT INTO sessions (token, user_id, role, email, username, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', '-8 days'));")
            .run(expiredToken, alexUser.id, alexUser.role, alexUser.email, alexUser.username);

        const res = await request('/api/customer/orders', {
            headers: { 'Authorization': `Bearer ${expiredToken}` }
        });
        assert.strictEqual(res.status, 401, 'Просроченная сессия должна отклоняться');

        // Проверяем, что просроченная сессия удалена из базы
        const inDb = db.db.prepare('SELECT * FROM sessions WHERE token = ?;').get(expiredToken);
        assert.strictEqual(inDb, undefined, 'Просроченная сессия удалена из таблицы sessions');
    });

    await test('Разрешение коллизий username при регистрации двух пользователей с одинаковым префиксом email', async () => {
        const email1 = `col_user_${Date.now()}@alpha.ru`;
        const email2 = `col_user_${Date.now()}@beta.ru`;

        const res1 = await request('/api/auth/register', {
            method: 'POST',
            body: { name: 'Первый', email: email1, password: 'password123' }
        });
        assert.strictEqual(res1.status, 201);
        const user1 = res1.body.user;

        const res2 = await request('/api/auth/register', {
            method: 'POST',
            body: { name: 'Второй', email: email2, password: 'password456' }
        });
        assert.strictEqual(res2.status, 201);
        const user2 = res2.body.user;

        assert.notStrictEqual(user1.username, user2.username, 'Логины двух пользователей должны различаться');

        // Проверяем, что в БД имя пользователя строго соответствует возвращенному значению
        const inDbUser2 = db.db.prepare('SELECT username FROM users WHERE email = ? COLLATE NOCASE;').get(email2);
        assert.strictEqual(user2.username, inDbUser2.username, 'Возвращенный логин должен строго совпадать с сохраненным в БД');

        // Проверяем возможность успешной авторизации второго пользователя по сгенерированному логину
        const loginRes2 = await request('/api/auth/login', {
            method: 'POST',
            body: { login: user2.username, password: 'password456' }
        });
        assert.strictEqual(loginRes2.status, 200, 'Второй пользователь может войти по своему уникальному логину');

        // Очищаем тестовых пользователей
        db.db.prepare('DELETE FROM users WHERE email IN (?, ?);').run(email1, email2);
    });

    await test('POST /api/auth/login и /api/admin/login отклоняют нестроковые типы данных (числа) с кодом 400', async () => {
        const resLogin = await request('/api/auth/login', {
            method: 'POST',
            body: { login: 12345, password: 'abc' }
        });
        assert.strictEqual(resLogin.status, 400, 'Логин числового типа должен отклоняться со статусом 400, а не 500');

        const resAdmin = await request('/api/admin/login', {
            method: 'POST',
            body: { login: 99999, password: 'abc' }
        });
        assert.strictEqual(resAdmin.status, 400, 'Админский логин числового типа должен отклоняться со статусом 400');
    });

    await test('POST /api/auth/register отклоняет некорректный или короткий числовой пароль (защита от обхода)', async () => {
        const res = await request('/api/auth/register', {
            method: 'POST',
            body: { email: `short_num_${Date.now()}@test.ru`, password: 123 }
        });
        assert.strictEqual(res.status, 400, 'Числовой пароль длиной менее 4 символов должен отклоняться');
    });

    await test('POST /api/orders не привязывает гостевой заказ к чужому аккаунту при совпадении номера телефона', async () => {
        const guestEmail = `phone_isolation_${Date.now()}@stranger.ru`;
        // Используем телефон alex.gamer@gmail.com (+7 (999) 123-45-67)
        const orderRes = await request('/api/orders', {
            method: 'POST',
            body: {
                customer_email: guestEmail,
                customer_phone: '+7 (999) 123-45-67',
                customer_name: 'Посторонний',
                items: [{ id: demoProduct.id, quantity: 1 }]
            }
        });
        assert.strictEqual(orderRes.status, 201);
        const orderId = orderRes.body.order_id || orderRes.body.order.id;

        const alex = db.db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE;').get('alex.gamer@gmail.com');
        const orderInDb = db.db.prepare('SELECT user_id, customer_email FROM orders WHERE id = ?;').get(orderId);

        assert.notStrictEqual(orderInDb.user_id, alex.id, 'Заказ гостя не должен связываться с чужим user_id по номеру телефона');

        // Очищаем заказ
        db.db.prepare('DELETE FROM order_items WHERE order_id = ?;').run(orderId);
        db.db.prepare('DELETE FROM orders WHERE id = ?;').run(orderId);
        db.db.prepare('DELETE FROM users WHERE email = ?;').run(guestEmail);
    });

    // -------------------------------------------------------------
    // РАЗДЕЛ 5: АВТОРИЗАЦИЯ АДМИНИСТРАТОРА (tpemeri / rqllo) И АНАЛИТИКА
    // -------------------------------------------------------------
    console.log('\n🛡️ [5/5] Тестирование входа администратора (tpemeri / rqllo) и аналитики:');

    let adminToken = null;

    await test('POST /api/auth/login успешно авторизует администратора tpemeri / rqllo', async () => {
        const res = await request('/api/auth/login', {
            method: 'POST',
            body: { login: 'tpemeri', password: 'rqllo' }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.success);
        assert.strictEqual(res.body.role, 'admin');
        assert.strictEqual(res.body.user.username, 'tpemeri');
        assert.ok(res.body.token, 'Токен администратора выдан');
        adminToken = res.body.token;
    });

    await test('POST /api/auth/login отклоняет неверный пароль администратора (401)', async () => {
        const res = await request('/api/auth/login', {
            method: 'POST',
            body: { login: 'tpemeri', password: 'wrongpassword999' }
        });
        assert.strictEqual(res.status, 401);
    });

    await test('GET /api/admin/stats без админского токена возвращает 401 Unauthorized', async () => {
        const res = await request('/api/admin/stats');
        assert.strictEqual(res.status, 401);
    });

    await test('GET /api/admin/stats с токеном покупателя возвращает 403 Forbidden', async () => {
        const res = await request('/api/admin/stats', {
            headers: { 'Authorization': `Bearer ${customerToken}` }
        });
        assert.strictEqual(res.status, 403);
    });

    await test('GET /api/admin/orders без админского токена возвращает 401 Unauthorized', async () => {
        const res = await request('/api/admin/orders');
        assert.strictEqual(res.status, 401);
    });

    await test('GET /api/admin/orders с токеном покупателя возвращает 403 Forbidden', async () => {
        const res = await request('/api/admin/orders', {
            headers: { 'Authorization': `Bearer ${customerToken}` }
        });
        assert.strictEqual(res.status, 403);
    });

    await test('GET /api/admin/stats возвращает аналитические метрики выручки и остатков', async () => {
        const res = await request('/api/admin/stats', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(res.status, 200);
        const revenue = res.body.totalRevenue ?? res.body.total_revenue;
        const orders = res.body.totalOrders ?? res.body.total_orders;
        const stock = res.body.keysInStock ?? res.body.keys_in_stock;
        assert.ok(revenue >= 0, 'Выручка посчитана');
        assert.ok(orders >= 1, 'Минимум 1 заказ зафиксирован');
        assert.ok(stock >= 0, 'Остаток ключей посчитан');
    });

    await test('GET /api/admin/orders возвращает глобальный реестр заказов с ключами', async () => {
        const res = await request('/api/admin/orders', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
        assert.ok(res.body.length >= 1);
    });

    await test('POST /api/admin/keys без прав администратора возвращает 401 и 403', async () => {
        const resNoToken = await request('/api/admin/keys', {
            method: 'POST',
            body: { product_id: demoProduct.id, keys: ['TEST-KEY-1'] }
        });
        assert.strictEqual(resNoToken.status, 401);

        const resCustToken = await request('/api/admin/keys', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${customerToken}` },
            body: { product_id: demoProduct.id, keys: ['TEST-KEY-1'] }
        });
        assert.strictEqual(resCustToken.status, 403);
    });

    await test('POST /api/admin/keys пополняет склад новыми ключами', async () => {
        const testKeys = [
            'DIPLM-AAAAA-BBBBB-11111',
            'DIPLM-CCCCC-DDDDD-22222',
            'DIPLM-EEEEE-FFFFF-33333'
        ];
        const res = await request('/api/admin/keys', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: {
                product_id: demoProduct.id,
                keys: testKeys
            }
        });
        assert.strictEqual(res.status, 200);
        const count = res.body.addedCount ?? res.body.added_count;
        assert.strictEqual(count, 3, 'Все 3 ключа загружены на склад');
    });

    await test('POST /api/admin/products без прав администратора возвращает 401 и 403', async () => {
        const resNoToken = await request('/api/admin/products', {
            method: 'POST',
            body: { name: 'Hacked Product', price: 999 }
        });
        assert.strictEqual(resNoToken.status, 401);

        const resCustToken = await request('/api/admin/products', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${customerToken}` },
            body: { name: 'Hacked Product', price: 999 }
        });
        assert.strictEqual(resCustToken.status, 403);
    });

    let createdTestProductId = null;

    await test('POST /api/admin/products успешно добавляет новый товар в каталог', async () => {
        const newProd = {
            category_id: 1,
            platform_id: 1,
            name: 'Тестовая Игра 2026',
            price: 1990,
            short_desc: 'Для проверки API',
            region: 'Global'
        };
        const res = await request('/api/admin/products', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: newProd
        });
        assert.strictEqual(res.status, 201);
        assert.ok(res.body.success);
        assert.ok(res.body.productId, 'Присвоен ID нового товара');
        createdTestProductId = res.body.productId;
    });

    await test('DELETE /api/admin/products/:id без прав администратора возвращает 401 и 403', async () => {
        const resNoToken = await request(`/api/admin/products/${createdTestProductId}`, {
            method: 'DELETE'
        });
        assert.strictEqual(resNoToken.status, 401);

        const resCustToken = await request(`/api/admin/products/${createdTestProductId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${customerToken}` }
        });
        assert.strictEqual(resCustToken.status, 403);
    });

    await test('DELETE /api/admin/products/:id корректно очищает тестовый товар после завершения теста', async () => {
        assert.ok(createdTestProductId, 'ID тестового товара определен');
        const res = await request(`/api/admin/products/${createdTestProductId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(res.body.success);

        // Проверяем, что товар действительно удален из каталога
        const checkRes = await request(`/api/products/${createdTestProductId}`);
        assert.strictEqual(checkRes.status, 404, 'Тестовый товар отсутствует в каталоге');
    });

    await test('GET /api/admin/kb защищен: возвращает 401 без токена, 403 покупателю и 200 администратору', async () => {
        const resNoToken = await request('/api/admin/kb');
        assert.strictEqual(resNoToken.status, 401);

        const resCust = await request('/api/admin/kb', {
            headers: { 'Authorization': `Bearer ${customerToken}` }
        });
        assert.strictEqual(resCust.status, 403);

        const resAdmin = await request('/api/admin/kb', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(resAdmin.status, 200);
        assert.ok(Array.isArray(resAdmin.body));
    });

    await test('POST /api/admin/kb защищен: возвращает 401 без токена, 403 покупателю и 201 администратору', async () => {
        const newArt = {
            category: 'Регламент',
            question: 'Тестовый вопрос безопасности?',
            answer: 'Тестовый ответ регламента.',
            is_staff: 1
        };

        const resNoToken = await request('/api/admin/kb', {
            method: 'POST',
            body: newArt
        });
        assert.strictEqual(resNoToken.status, 401);

        const resCust = await request('/api/admin/kb', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${customerToken}` },
            body: newArt
        });
        assert.strictEqual(resCust.status, 403);

        const resAdmin = await request('/api/admin/kb', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: newArt
        });
        assert.strictEqual(resAdmin.status, 201);
        assert.ok(resAdmin.body.id);
    });

    await test('GET /api/kb возвращает статьи Базы Знаний и регламенты', async () => {
        const res = await request('/api/kb?all=1');
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.body));
        assert.ok(res.body.length >= 4, 'Присутствуют базовые статьи FAQ и регламенты');
    });

    await test('POST /api/kb создает новую регламентную статью', async () => {
        const res = await request('/api/kb', {
            method: 'POST',
            body: {
                category: 'Безопасность',
                question: 'Как шифруются пароли администраторов?',
                answer: 'Используется криптографический алгоритм SHA-256 с солью.',
                is_staff: 1
            }
        });
        assert.strictEqual(res.status, 201);
        assert.ok(res.body.id);
    });

    await test('Клиентский app.js выполняется в среде браузера без ReferenceError и экспортирует все функции', async () => {
        const fs = require('fs');
        const vm = require('vm');
        const code = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
        const context = {
            window: {},
            document: {
                addEventListener: () => {},
                getElementById: () => null,
                querySelectorAll: () => []
            },
            localStorage: {
                getItem: () => null,
                setItem: () => {},
                removeItem: () => {}
            },
            console: { log: () => {}, error: () => {}, warn: () => {} }
        };
        context.window = context;
        vm.runInNewContext(code, context);

        const requiredExports = [
            'openCabinetModal', 'toggleKeyVisibility', 'cabinetLogout', 'openAuthModal',
            'switchAuthTab', 'handleAuthLogin', 'handleAuthRegister', 'handleLogout',
            'openAdminModal', 'switchAdminTab', 'loadAdminStats', 'loadAdminOrders',
            'handleAddProduct', 'handleAddKeys', 'generateDemoKeysForStock', 'handleAddKB', 'copyIssuedKey'
        ];
        for (const fn of requiredExports) {
            assert.strictEqual(typeof context.window[fn], 'function', `Функция ${fn} должна быть экспортирована в window`);
        }
    });

    // Гарантируем очистку тестовых товаров после завершения тестирования
    db.cleanupTestProducts();

    // -------------------------------------------------------------
    // ИТОГОВЫЙ ОТЧЕТ
    // -------------------------------------------------------------
    console.log('\n===============================================================');
    console.log(`ИТОГИ ТЕСТИРОВАНИЯ:`);
    console.log(`  Всего тестов:   ${passedTests + failedTests}`);
    console.log(`  \x1b[32mУспешно:        ${passedTests}\x1b[0m`);
    if (failedTests > 0) {
        console.log(`  \x1b[31mОшибок:         ${failedTests}\x1b[0m`);
    } else {
        console.log(`  \x1b[32mОшибок:         0 (100% ПОКРЫТИЕ ПАСИРОВАНО)\x1b[0m`);
    }
    console.log('===============================================================\n');

    if (failedTests > 0) {
        throw new Error(`Провалено тестов: ${failedTests}`);
    }
}

// Запуск при прямом вызове
if (require.main === module) {
    runTestSuite().catch(err => {
        console.error('Тестирование завершено с ошибкой:', err.message);
        process.exit(1);
    });
}

module.exports = { runTestSuite };
