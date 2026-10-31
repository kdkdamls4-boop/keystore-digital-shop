/**
 * ==============================================================================
 * СЕРВЕР ПРИЛОЖЕНИЙ EXPRESS (server.js)
 * Интернет-магазин цифровых товаров и лицензионных ключей «KeyStore»
 * ==============================================================================
 * 
 * Архитектура:
 * - RESTful API для клиентской части и панели администратора
 * - Валидация входных параметров и экранирование
 * - Раздача статических файлов клиентского приложения (HTML, CSS, JS)
 * - Управление цифровыми заказами и пулом лицензионных ключей
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Логирование входящих API-запросов в консоль
app.use('/api', (req, res, next) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);
    next();
});

// ==========================================
// 1. СПРАВОЧНИКИ И КАТАЛОГ ТОВАРОВ
// ==========================================

/**
 * GET /api/categories - Получение списка всех категорий
 */
app.get('/api/categories', (req, res) => {
    try {
        const categories = db.getCategories();
        res.json(categories);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения категорий: ' + err.message });
    }
});

/**
 * GET /api/platforms - Получение списка игровых и программных платформ
 */
app.get('/api/platforms', (req, res) => {
    try {
        const platforms = db.getPlatforms();
        res.json(platforms);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения платформ: ' + err.message });
    }
});

/**
 * GET /api/products - Каталог товаров с поддержкой фильтров, поиска и сортировки
 * Параметры запроса (Query Params):
 * - category: слаг категории ('games', 'software', 'subscriptions', 'gift-cards')
 * - platform: слаг платформы ('steam', 'playstation', 'xbox', 'windows')
 * - search: строка поиска по названию или описанию
 * - sort: 'popular', 'price-asc', 'price-desc', 'rating'
 */
app.get('/api/products', (req, res) => {
    try {
        const { category, platform, search, sort } = req.query;
        const products = db.getProducts({ category, platform, search, sort });
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка загрузки каталога товаров: ' + err.message });
    }
});

/**
 * GET /api/products/:id - Детальная карточка цифрового товара
 */
app.get('/api/products/:id', (req, res) => {
    try {
        const productId = parseInt(req.params.id);
        if (isNaN(productId)) {
            return res.status(400).json({ error: 'Некорректный идентификатор товара' });
        }

        const product = db.getProductById(productId);
        if (!product) {
            return res.status(404).json({ error: 'Товар не найден' });
        }

        res.json(product);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения товара: ' + err.message });
    }
});

// ==========================================
// 2. ПРОМОКОДЫ И ОФОРМЛЕНИЕ ЗАКАЗОВ
// ==========================================

/**
 * POST /api/promocode/check - Проверка валидности промокода
 * Тело запроса: { code: "DIPLOM2026" }
 */
app.post('/api/promocode/check', (req, res) => {
    try {
        const { code, totalAmount } = req.body;
        if (!code || typeof code !== 'string') {
            return res.status(400).json({ valid: false, error: 'Необходимо передать промокод' });
        }

        const promo = db.checkPromoCode(code);
        if (!promo) {
            return res.status(400).json({ valid: false, error: 'Промокод не найден или срок его действия истек' });
        }

        const total = typeof totalAmount === 'number' ? totalAmount : 0;
        if (promo.min_order_amount > 0 && total > 0 && total < promo.min_order_amount) {
            return res.status(400).json({
                valid: false,
                error: `Минимальная сумма заказа для применения промокода: ${promo.min_order_amount} ₽`
            });
        }

        const discountPercent = promo.discount_percent;
        const discountAmount = total > 0 ? Math.round(total * (discountPercent / 100)) : 0;
        const finalAmount = Math.max(0, total - discountAmount);

        res.json({
            success: true,
            valid: true,
            code: promo.code,
            discount_percent: discountPercent,
            discount_amount: discountAmount,
            final_amount: finalAmount,
            min_order_amount: promo.min_order_amount
        });
    } catch (err) {
        res.status(500).json({ valid: false, error: 'Ошибка проверки промокода: ' + err.message });
    }
});

/**
 * POST /api/orders - Оформление заказа и мгновенная выдача лицензионных ключей
 * Тело запроса:
 * {
 *   customer_email: "user@example.com",
 *   customer_phone: "+7 (999) 000-00-00",
 *   customer_name: "Иван Иванов",
 *   payment_method: "Банковская карта",
 *   promo_code: "DIPLOM2026",
 *   items: [{ id: 1, quantity: 1 }]
 * }
 */
app.post('/api/orders', (req, res) => {
    try {
        const { customer_email, customer_phone, customer_name, payment_method, promo_code, items } = req.body;

        if (!customer_email || typeof customer_email !== 'string' || !customer_email.includes('@')) {
            return res.status(400).json({ error: 'Укажите корректный адрес электронной почты для получения ключа' });
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Корзина заказа не может быть пустой' });
        }

        const orderResult = db.createOrder({
            customer_email,
            customer_phone,
            customer_name,
            payment_method,
            promo_code,
            items
        });

        const issuedItems = (orderResult.keys || []).map(k => ({
            product_id: k.productId,
            product_name: k.productName,
            license_key: k.keyCode,
            keyCode: k.keyCode
        }));

        res.status(201).json({
            success: true,
            message: 'Заказ успешно оплачен. Лицензионные ключи сгенерированы и доступны на экране.',
            order_id: orderResult.id,
            order_number: orderResult.orderNumber,
            orderNumber: orderResult.orderNumber,
            total_price: orderResult.totalPrice,
            totalPrice: orderResult.totalPrice,
            items: issuedItems,
            keys: orderResult.keys,
            order: orderResult
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
// ==========================================
// 3. АУТЕНТИФИКАЦИЯ И КОНТРОЛЬ ДОСТУПА (RBAC)
// ==========================================

/**
 * Вспомогательная функция извлечения Bearer-токена из заголовков запроса
 */
function extractBearerToken(req) {
    const auth = req.headers['authorization'] || req.headers['Authorization'];
    if (auth && typeof auth === 'string') {
        const match = auth.match(/^Bearer\s+(.+)$/i);
        if (match) {
            const token = match[1].trim().replace(/^["']|["']$/g, '');
            if (token) return token;
        }
    }
    return null;
}

/**
 * Middleware: Проверка авторизации покупателя
 * Защищает доступ к персональным данным и истории лицензионных ключей
 */
function requireCustomerAuth(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Требуется токен авторизации (Authorization: Bearer <token>)' });
    }

    const session = db.getSession(token);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized: Недействительный или истекший токен сессии' });
    }

    req.user = session;
    next();
}

/**
 * Middleware: Проверка прав администратора (RBAC)
 * Защищает административные эндпоинты /api/admin/*
 */
function requireAdminAuth(req, res, next) {
    // Вход администратора (/api/admin/login) доступен без токена только методом POST
    if (req.method === 'POST' && (req.path === '/login' || req.path === '/login/')) {
        return next();
    }

    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Требуется токен авторизации администратора' });
    }

    const session = db.getSession(token);
    if (!session) {
        return res.status(401).json({ error: 'Unauthorized: Недействительный токен сессии' });
    }

    if (session.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Недостаточно прав доступа. Требуется роль администратора' });
    }

    req.user = session;
    next();
}

/**
 * POST /api/auth/register - Регистрация покупателя по Email и паролю
 */
app.post('/api/auth/register', (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email и пароль обязательны для регистрации' });
        }
        if (typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Email и пароль должны быть строками' });
        }
        if (password.length < 4) {
            return res.status(400).json({ error: 'Пароль должен содержать не менее 4 символов' });
        }

        const user = db.registerUser({ name, email, password, phone });
        const token = db.createSession(user);

        res.status(201).json({
            success: true,
            message: 'Регистрация успешно завершена',
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                email: user.email,
                role: user.role
            },
            role: user.role,
            token
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * POST /api/auth/login - Единая авторизация (для клиентов и администратора tpemeri)
 */
app.post('/api/auth/login', (req, res) => {
    try {
        const { login, password } = req.body;
        if (!login || !password) {
            return res.status(400).json({ error: 'Введите логин или email и пароль' });
        }
        if (typeof login !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Логин и пароль должны быть строками' });
        }

        const user = db.authenticateUser(login, password);
        if (!user) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        const token = db.createSession(user);

        res.json({
            success: true,
            role: user.role,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                email: user.email,
                role: user.role
            },
            token
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка аутентификации: ' + err.message });
    }
});

/**
 * GET /api/customer/orders - Получение истории купленных ключей покупателя
 * Защищен Bearer-токеном. Покупатель получает доступ исключительно к своим собственным заказам.
 */
app.get('/api/customer/orders', requireCustomerAuth, (req, res) => {
    try {
        // Покупатель через API может получить доступ исключительно к своим собственным заказам и ключам
        let targetEmail = req.user.email;
        if (req.user.role === 'admin' && req.query.email) {
            targetEmail = req.query.email.trim().toLowerCase();
        }

        const orders = db.getCustomerOrders(targetEmail);
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения заказов: ' + err.message });
    }
});

// ==========================================
// 4. ПАНЕЛЬ АДМИНИСТРАТОРА (ADMIN RBAC)
// ==========================================

// Защита всех эндпоинтов /api/admin/* серверным middleware
app.use('/api/admin', requireAdminAuth);

/**
 * POST /api/admin/login - Авторизация администратора (tpemeri / rqllo)
 */
app.post('/api/admin/login', (req, res) => {
    try {
        const { login, password } = req.body;
        if (!login || !password) {
            return res.status(400).json({ error: 'Введите логин и пароль администратора' });
        }
        if (typeof login !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Логин и пароль должны быть строками' });
        }

        const admin = db.authenticateUser(login, password);
        if (!admin || admin.role !== 'admin') {
            return res.status(401).json({ error: 'Неверные учетные данные администратора' });
        }

        const token = db.createSession(admin);

        res.json({
            success: true,
            role: admin.role,
            user: {
                id: admin.id,
                name: admin.name,
                username: admin.username,
                email: admin.email,
                role: admin.role
            },
            token
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка аутентификации: ' + err.message });
    }
});

/**
 * GET /api/admin/stats - Аналитика продаж и ключевые KPI магазина
 */
app.get('/api/admin/stats', (req, res) => {
    try {
        const stats = db.getAdminStats();
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения аналитики: ' + err.message });
    }
});

/**
 * GET /api/admin/orders - Реестр заказов и выданных ключей
 */
app.get('/api/admin/orders', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const orders = db.getAllOrders(limit);
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения списка заказов: ' + err.message });
    }
});

/**
 * POST /api/admin/products - Добавление нового цифрового товара
 */
app.post('/api/admin/products', (req, res) => {
    try {
        const { category_id, platform_id, name, title, short_desc, description, full_desc, activation_guide, price, old_price, region, image_url, badge } = req.body;
        const productName = (name || title || '').trim();

        const numPrice = parseFloat(price);
        if (!category_id || !platform_id || !productName || isNaN(numPrice) || numPrice <= 0) {
            return res.status(400).json({ error: 'Заполните обязательные поля: категория, платформа, название и корректная цена' });
        }

        const newId = db.addProduct({
            category_id: parseInt(category_id),
            platform_id: parseInt(platform_id),
            name: productName,
            short_desc: short_desc || '',
            description: description || full_desc || productName,
            activation_guide: activation_guide || 'Активируйте ключ в клиенте вашей платформы.',
            price: parseFloat(price),
            old_price: old_price ? parseFloat(old_price) : null,
            region: region || 'Global',
            image_url: image_url || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800',
            badge: badge || ''
        });

        res.status(201).json({
            success: true,
            productId: newId,
            message: 'Товар успешно добавлен в каталог'
        });
    } catch (err) {
        res.status(400).json({ error: 'Ошибка добавления товара: ' + err.message });
    }
});

/**
 * DELETE /api/admin/products/:id - Удаление цифрового товара из каталога (очистка)
 */
app.delete('/api/admin/products/:id', (req, res) => {
    try {
        const productId = parseInt(req.params.id);
        if (isNaN(productId)) {
            return res.status(400).json({ error: 'Некорректный ID товара' });
        }

        const deleted = db.deleteProduct(productId);
        if (!deleted) {
            return res.status(404).json({ error: 'Товар не найден' });
        }

        res.json({
            success: true,
            message: 'Товар успешно удален из каталога'
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка удаления товара: ' + err.message });
    }
});

/**
 * POST /api/admin/keys - Пакетное пополнение склада лицензионных ключей
 */
app.post('/api/admin/keys', (req, res) => {
    try {
        const { product_id, keys } = req.body;

        if (!product_id || !Array.isArray(keys) || keys.length === 0) {
            return res.status(400).json({ error: 'Укажите ID товара и массив ключей для пополнения' });
        }

        const addedCount = db.addKeysToStock(parseInt(product_id), keys);

        res.json({
            success: true,
            addedCount,
            added_count: addedCount,
            message: `Успешно загружено ключей на склад: ${addedCount}`
        });
    } catch (err) {
        res.status(400).json({ error: 'Ошибка пополнения ключей: ' + err.message });
    }
});

/**
 * GET /api/admin/kb - Управление Базой Знаний и регламентами (администратор)
 */
app.get('/api/admin/kb', (req, res) => {
    try {
        const kb = db.getKnowledgeBase(1);
        res.json(kb);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка загрузки Базы Знаний: ' + err.message });
    }
});

/**
 * POST /api/admin/kb - Добавление статьи Базы Знаний администратором
 */
app.post('/api/admin/kb', (req, res) => {
    try {
        const { category, question, answer, is_staff, is_staff_only } = req.body;
        if (!category || !question || !answer) {
            return res.status(400).json({ error: 'Все поля статьи обязательны' });
        }

        const staffFlag = (is_staff || is_staff_only) ? 1 : 0;
        const id = db.addKBArticle(category.trim(), question.trim(), answer.trim(), staffFlag);
        res.status(201).json({ success: true, id, message: 'Статья сохранена' });
    } catch (err) {
        res.status(400).json({ error: 'Ошибка сохранения статьи: ' + err.message });
    }
});

// ==========================================
// 5. БАЗА ЗНАНИЙ И FAQ
// ==========================================

/**
 * GET /api/kb - Получение статей Базы Знаний
 * ?staff=1 для регламентов сотрудников
 */
app.get('/api/kb', (req, res) => {
    try {
        const isStaff = (req.query.staff === '1' || req.query.all === '1') ? 1 : 0;
        const kb = db.getKnowledgeBase(isStaff);
        res.json(kb);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка загрузки Базы Знаний: ' + err.message });
    }
});

/**
 * POST /api/kb - Добавление новой статьи или ответа в FAQ
 */
app.post('/api/kb', (req, res) => {
    try {
        const { category, question, answer, is_staff, is_staff_only } = req.body;
        if (!category || !question || !answer) {
            return res.status(400).json({ error: 'Все поля статьи обязательны' });
        }

        const staffFlag = (is_staff || is_staff_only) ? 1 : 0;
        const id = db.addKBArticle(category.trim(), question.trim(), answer.trim(), staffFlag);
        res.status(201).json({ success: true, id, message: 'Статья сохранена' });
    } catch (err) {
        res.status(400).json({ error: 'Ошибка сохранения статьи: ' + err.message });
    }
});

// ==========================================
// 6. ОБРАБОТКА МАРШРУТОВ И ОШИБОК
// ==========================================

// SPA-редирект: возвращаем index.html для всех не-API маршрутов
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    console.error('Необработанная ошибка сервера:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера: ' + err.message });
});

// Запуск сервера
const server = app.listen(PORT, () => {
    console.log('\n===============================================================');
    console.log('🎮 KeyStore (DigitalKey Hub) — Сервер успешно запущен!');
    console.log('===============================================================');
    console.log(`📍 Веб-сервис:              http://localhost:${PORT}`);
    console.log('🛡️  Администратор:          tpemeri / rqllo (вход на главной)');
    console.log('💾 База данных SQLite:      keystore.db');
    console.log('===============================================================\n');
});

module.exports = { app, server };
