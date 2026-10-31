/**
 * ==============================================================================
 * МОДУЛЬ РАБОТЫ С БАЗОЙ ДАННЫХ (database.js)
 * Интернет-магазин цифровых товаров и лицензионных ключей «KeyStore»
 * ==============================================================================
 * 
 * Назначение:
 * - Инициализация реляционной базы данных SQLite (файл keystore.db)
 * - Хранение каталога цифровых товаров (игры, софт, подписки, карты оплаты)
 * - Управление складом цифровых ключей (License Keys Pool)
 * - Мгновенная выдача и резервирование лицензионных ключей при покупке
 * - Личный кабинет покупателя с историей всех купленных ключей
 * - Аутентификация администратора с безопасным хэшированием паролей (SHA-256)
 * - Аналитика продаж и встроенная База Знаний (FAQ и регламенты)
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('node:crypto');

// Путь к файлу базы данных в корневой папке проекта
const dbPath = path.join(__dirname, 'keystore.db');

// Подключение к базе данных SQLite
const db = new DatabaseSync(dbPath);

// Включаем поддержку внешних ключей (Foreign Keys)
db.exec('PRAGMA foreign_keys = ON;');

/**
 * Хэширование пароля с помощью криптографического алгоритма SHA-256
 * @param {string} password - Исходный пароль в открытом виде
 * @returns {string} - Шестнадцатеричный хэш пароля
 */
function hashPassword(password) {
    return crypto.createHash('sha256').update(String(password).trim()).digest('hex');
}

/**
 * Генерация реалистичного лицензионного ключа активации
 * Формат: XXXXX-XXXXX-XXXXX-XXXXX
 * @param {string} [prefix='KEY'] - Префикс или тип
 * @returns {string}
 */
function generateKey(prefix = 'KEY') {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const makeBlock = (len = 5) => {
        let res = '';
        for (let i = 0; i < len; i++) {
            res += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return res;
    };
    return `${makeBlock(5)}-${makeBlock(5)}-${makeBlock(5)}-${makeBlock(5)}`;
}

/**
 * Инициализация таблиц базы данных
 */
function initDatabase() {
    // 1. Категории цифровых товаров
    db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            icon TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0
        );
    `);

    // 2. Игровые и программные платформы (Steam, PlayStation, Windows и т.д.)
    db.exec(`
        CREATE TABLE IF NOT EXISTS platforms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            badge_color TEXT DEFAULT '#0071e3',
            icon TEXT DEFAULT '💻'
        );
    `);

    // 3. Каталог цифровых товаров
    db.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
            platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
            name TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            short_desc TEXT,
            description TEXT NOT NULL,
            activation_guide TEXT NOT NULL,
            price REAL NOT NULL,
            old_price REAL,
            region TEXT DEFAULT 'Global',
            image_url TEXT NOT NULL,
            badge TEXT DEFAULT '',
            rating REAL DEFAULT 4.9,
            sales_count INTEGER DEFAULT 0,
            is_available INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // 4. Склад лицензионных ключей (License Keys Pool)
    db.exec(`
        CREATE TABLE IF NOT EXISTS license_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            key_code TEXT NOT NULL,
            is_used INTEGER DEFAULT 0,
            order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
            claimed_at TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // 5. Промокоды на скидку
    db.exec(`
        CREATE TABLE IF NOT EXISTS promocodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            discount_percent INTEGER NOT NULL,
            is_active INTEGER DEFAULT 1,
            min_order_amount REAL DEFAULT 0
        );
    `);

    // 6. Пользователи системы (Клиенты и Администраторы)
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            phone TEXT,
            name TEXT NOT NULL,
            password_hash TEXT,
            role TEXT DEFAULT 'customer',
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    try {
        db.exec("ALTER TABLE users ADD COLUMN username TEXT;");
        db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);");
    } catch (_) {
        // Колонка username уже существует
    }

    // 7. Заказы покупателей
    db.exec(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT UNIQUE NOT NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            customer_email TEXT NOT NULL,
            customer_phone TEXT,
            customer_name TEXT,
            payment_method TEXT DEFAULT 'Банковская карта',
            promo_code TEXT,
            discount_percent INTEGER DEFAULT 0,
            subtotal REAL NOT NULL,
            total_price REAL NOT NULL,
            status TEXT DEFAULT 'completed',
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // 8. Позиции заказа с выданными цифровыми ключами
    db.exec(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id),
            product_name TEXT NOT NULL,
            price REAL NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            license_key TEXT NOT NULL
        );
    `);

    // 9. База Знаний (FAQ для покупателей и регламенты для сотрудников)
    db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_base (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            is_staff INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0
        );
    `);

    // 10. Сессии авторизации пользователей и администратора (Bearer Tokens)
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            email TEXT NOT NULL,
            username TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );
    `);

    // Создаем индексы для ускорения поиска и фильтрации
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
        CREATE INDEX IF NOT EXISTS idx_products_platform ON products(platform_id);
        CREATE INDEX IF NOT EXISTS idx_keys_product_used ON license_keys(product_id, is_used);
        CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customer_email);
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `);

    // Первичное наполнение тестовыми данными
    seedInitialData();
}

/**
 * Наполнение базы данных стартовыми товарами, ключами, категориями и администратором
 */
function seedInitialData() {
    // Гарантируем наличие администратора tpemeri / rqllo
    const tpemeriUser = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE;').get('tpemeri', 'tpemeri@keystore.ru');
    if (!tpemeriUser) {
        db.prepare(`
            INSERT INTO users (username, email, phone, name, password_hash, role)
            VALUES (?, ?, ?, ?, ?, ?);
        `).run('tpemeri', 'tpemeri@keystore.ru', '+7 (999) 777-88-99', 'tpemeri', hashPassword('rqllo'), 'admin');
    } else {
        db.prepare(`
            UPDATE users
            SET username = 'tpemeri', email = 'tpemeri@keystore.ru', name = 'tpemeri', password_hash = ?, role = 'admin'
            WHERE id = ?;
        `).run(hashPassword('rqllo'), tpemeriUser.id);
    }

    // Демо-пользователь
    const demoUser = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE;').get('alex.gamer@gmail.com');
    if (!demoUser) {
        db.prepare(`
            INSERT INTO users (username, email, phone, name, password_hash, role)
            VALUES (?, ?, ?, ?, ?, ?);
        `).run('alex_gamer', 'alex.gamer@gmail.com', '+7 (999) 123-45-67', 'Алексей Смирнов', hashPassword('gamer123'), 'customer');
    } else {
        db.prepare(`
            UPDATE users
            SET username = 'alex_gamer', email = 'alex.gamer@gmail.com', name = 'Алексей Смирнов', password_hash = ?, role = 'customer'
            WHERE id = ?;
        `).run(hashPassword('gamer123'), demoUser.id);
    }

    const categoriesCount = db.prepare('SELECT COUNT(*) as count FROM categories;').get().count;
    if (categoriesCount > 0) {
        // Очищаем каталог от дубликатов тестовых товаров («Тестовая Игра 2026»)
        try {
            const testProds = db.prepare("SELECT id FROM products WHERE name LIKE 'Тестовая Игра%';").all();
            for (const p of testProds) {
                db.prepare('DELETE FROM license_keys WHERE product_id = ?;').run(p.id);
                db.prepare('DELETE FROM order_items WHERE product_id = ?;').run(p.id);
                db.prepare('DELETE FROM products WHERE id = ?;').run(p.id);
            }
        } catch (_) {}

        // Обеспечиваем качественные тематические обложки высокого разрешения для всех товаров
        const updateImg = db.prepare("UPDATE products SET image_url = ? WHERE slug = ?;");
        updateImg.run('https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&auto=format&fit=crop&q=80', 'cyberpunk-2077');
        updateImg.run('https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=1200&auto=format&fit=crop&q=80', 'elden-ring');
        updateImg.run('https://images.unsplash.com/photo-1511512578047-dfb367046420?w=1200&auto=format&fit=crop&q=80', 'gta-v-premium');
        updateImg.run('https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=1200&auto=format&fit=crop&q=80', 'spider-man-2-ps5');
        updateImg.run('https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&auto=format&fit=crop&q=80', 'forza-horizon-5');
        updateImg.run('https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=1200&auto=format&fit=crop&q=80', 'win-11-pro');
        updateImg.run('https://images.unsplash.com/photo-1517842645767-c639042777db?w=1200&auto=format&fit=crop&q=80', 'office-2024-pro');
        updateImg.run('https://images.unsplash.com/photo-1563986768609-322da13575f3?w=1200&auto=format&fit=crop&q=80', 'kaspersky-total');
        updateImg.run('https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=1200&auto=format&fit=crop&q=80', 'gamepass-ultimate-3m');
        updateImg.run('https://images.unsplash.com/photo-1507457379470-08b800bebc67?w=1200&auto=format&fit=crop&q=80', 'ps-plus-deluxe-12m');
        updateImg.run('https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1200&auto=format&fit=crop&q=80', 'tg-premium-12m');
        updateImg.run('https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&auto=format&fit=crop&q=80', 'steam-card-1000');

        // Гарантируем наличие резервного пула неиспользованных ключей (не менее 5) для каждого активного товара
        const allProds = db.prepare('SELECT id, slug FROM products WHERE is_available = 1;').all();
        const checkKeys = db.prepare('SELECT COUNT(*) as count FROM license_keys WHERE product_id = ? AND is_used = 0;');
        const insertKey = db.prepare('INSERT INTO license_keys (product_id, key_code, is_used) VALUES (?, ?, 0);');
        for (const prod of allProds) {
            const stock = checkKeys.get(prod.id).count;
            if (stock < 5) {
                for (let i = 0; i < (5 - stock); i++) {
                    insertKey.run(prod.id, generateKey(prod.slug));
                }
            }
        }

        return; // База уже наполнена
    }

    // 1. Категории
    const insertCat = db.prepare('INSERT INTO categories (name, slug, icon, sort_order) VALUES (?, ?, ?, ?);');
    insertCat.run('Игры', 'games', '🎮', 1);
    insertCat.run('Программы и ОС', 'software', '💻', 2);
    insertCat.run('Подписки и сервисы', 'subscriptions', '⚡', 3);
    insertCat.run('Подарочные карты', 'gift-cards', '🎁', 4);

    // 2. Платформы
    const insertPlat = db.prepare('INSERT INTO platforms (name, slug, badge_color, icon) VALUES (?, ?, ?, ?);');
    insertPlat.run('Steam', 'steam', '#171a21', '🎮');
    insertPlat.run('PlayStation', 'playstation', '#003791', '🕹️');
    insertPlat.run('Xbox', 'xbox', '#107c10', '🟢');
    insertPlat.run('Windows', 'windows', '#0078d4', '🪟');
    insertPlat.run('Epic Games', 'epic', '#2b2b2b', '🚀');
    insertPlat.run('Global', 'global', '#475569', '🌐');

    const catRows = db.prepare('SELECT id, slug FROM categories;').all();
    const cat = {};
    catRows.forEach(r => cat[r.slug] = r.id);

    const platRows = db.prepare('SELECT id, slug FROM platforms;').all();
    const plat = {};
    platRows.forEach(r => plat[r.slug] = r.id);

    // 3. Цифровые товары
    const insertProd = db.prepare(`
        INSERT INTO products (category_id, platform_id, name, slug, short_desc, description, activation_guide, price, old_price, region, image_url, badge, rating, sales_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    // Игры
    insertProd.run(
        cat['games'], plat['steam'],
        'Cyberpunk 2077: Ultimate Edition', 'cyberpunk-2077',
        'Ролевой боевик в открытом мире Найт-Сити с дополнением Phantom Liberty.',
        'Погрузитесь в мрачное будущее мегаполиса Найт-Сити. Станьте наемником по имени V и бросьте вызов корпорациям. Включает базовую игру и сюжетное расширение "Призрачная свобода".',
        '1. Запустите клиент Steam на ПК.\n2. В верхнем меню выберите "Игры" -> "Активировать в Steam...".\n3. Введите купленный цифровой ключ и следуйте инструкциям на экране.',
        1999, 2999, 'Global',
        'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop&q=80',
        'Хит', 4.9, 1420
    );

    insertProd.run(
        cat['games'], plat['steam'],
        'Elden Ring: Shadow of the Erdtree', 'elden-ring',
        'Культовая экшен-RPG от FromSoftware и Джорджа Мартина.',
        'Исследуйте Земли Между и Земли Теней. Сражайтесь с могущественными полубогами, создавайте свой неповторимый боевой стиль и раскройте тайну Кольца Элден.',
        '1. Откройте Steam -> Игры -> Активировать в Steam.\n2. Вставьте ваш лицензионный ключ.\n3. Игра появится в вашей библиотеке навсегда.',
        2490, 3190, 'Global',
        'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800&auto=format&fit=crop&q=80',
        'Топ-1', 5.0, 2180
    );

    insertProd.run(
        cat['games'], plat['steam'],
        'Grand Theft Auto V: Premium Edition', 'gta-v-premium',
        'Легендарный криминальный экшен в Лос-Сантосе со стартовым набором Criminal Enterprise.',
        'Одиночная сюжетная кампания о трех друзьях-грабителях и бесконечный мир GTA Online с бизнесами, суперкарами и ограблениями.',
        '1. Войдите в Rockstar Games Launcher или Steam.\n2. Нажмите "Активировать код" в настройках профиля.\n3. Введите ключ и начните загрузку.',
        1190, 1990, 'Global',
        'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&auto=format&fit=crop&q=80',
        'Скидка -40%', 4.8, 3850
    );

    insertProd.run(
        cat['games'], plat['playstation'],
        'Spider-Man 2 (PlayStation 5)', 'spider-man-2-ps5',
        'Кинематографичный экшен о Питере Паркере и Майлзе Моралесе против Венома.',
        'Исследуйте обновленный Нью-Йорк с Квинсом и Бруклином, мгновенно переключайтесь между двумя Пауками с невероятной скоростью SSD PS5.',
        '1. Откройте PlayStation Store на вашей консоли PS5.\n2. Перейдите в меню своего профиля -> "Погашение кодов".\n3. Введите 12-значный цифровой код ваучера.',
        3490, 4990, 'РФ и СНГ',
        'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800&auto=format&fit=crop&q=80',
        'Хит PS5', 4.9, 930
    );

    insertProd.run(
        cat['games'], plat['xbox'],
        'Forza Horizon 5: Premium Edition', 'forza-horizon-5',
        'Великолепный автофестиваль на бескрайних дорогах живописной Мексики.',
        'Сотни лучших автомобилей мира, реалистичная физика, динамическая погода и пыльные бури. Включает DLC Hot Wheels и Rally Adventure.',
        '1. Откройте приложение Xbox или консоль Xbox Series X|S.\n2. Перейдите в Store -> Использовать код.\n3. Введите лицензионный 25-значный ключ.',
        2190, 3490, 'Global',
        'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800&auto=format&fit=crop&q=80',
        'Выбор игроков', 4.9, 1140
    );

    // Программы и ОС
    insertProd.run(
        cat['software'], plat['windows'],
        'Microsoft Windows 11 Pro (Retail)', 'win-11-pro',
        'Оригинальная бессрочная лицензия Windows 11 Профессиональная с привязкой к учетной записи.',
        'Полноценная операционная система для работы и дома. Поддержка BitLocker шифрования, песочницы Windows Sandbox, Hyper-V и обновлений безопасности пожизненно.',
        '1. Нажмите Пуск -> Параметры -> Система -> Активация.\n2. Нажмите "Изменить ключ продукта".\n3. Введите купленный 25-значный ключ и нажмите "Далее".',
        1490, 4990, 'Global',
        'https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=800&auto=format&fit=crop&q=80',
        'Бестселлер', 5.0, 4200
    );

    insertProd.run(
        cat['software'], plat['windows'],
        'Microsoft Office 2024 Pro Plus', 'office-2024-pro',
        'Бессрочный пакет офисных приложений Word, Excel, PowerPoint, Outlook, Access.',
        'Классические версии офисных программ без ежемесячной подписки. Официальная активация через сервера Microsoft с пожизненной гарантией.',
        '1. Перейдите на официальный сайт setup.office.com.\n2. Войдите под своей учетной записью Microsoft.\n3. Введите лицензионный ключ и скачайте официальный дистрибутив.',
        1890, 5490, 'Global',
        'https://images.unsplash.com/photo-1517842645767-c639042777db?w=800&auto=format&fit=crop&q=80',
        'Лицензия', 4.9, 3100
    );

    insertProd.run(
        cat['software'], plat['global'],
        'Kaspersky Total Security (1 год / 3 ПК)', 'kaspersky-total',
        'Максимальная киберзащита от вирусов, вымогателей, фишинга и кражи паролей.',
        'Комплексный антивирус с встроенным менеджером паролей, защитой онлайн-платежей, родительским контролем и безопасным VPN соединением.',
        '1. Скачайте дистрибутив с официального сайта kaspersky.ru.\n2. В окне программы нажмите "Ввести код активации".\n3. Вставьте ключ и нажмите "Активировать".',
        1290, 2190, 'РФ и СНГ',
        'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=800&auto=format&fit=crop&q=80',
        'Защита', 4.8, 850
    );

    // Подписки
    insertProd.run(
        cat['subscriptions'], plat['xbox'],
        'Xbox Game Pass Ultimate (3 месяца)', 'gamepass-ultimate-3m',
        'Доступ к библиотеке из 400+ игр для ПК и консолей + подписка EA Play.',
        'Играйте в новинки в день релиза (Call of Duty, Indiana Jones, Forza). Включает сетевой доступ Xbox Live Gold и облачный гейминг Cloud Gaming.',
        '1. Перейдите на redeem.microsoft.com.\n2. Авторизуйтесь под своим аккаунтом Xbox.\n3. Активируйте код и наслаждайтесь библиотекой игр.',
        1790, 2490, 'Global',
        'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=800&auto=format&fit=crop&q=80',
        'Популярно', 4.9, 2900
    );

    insertProd.run(
        cat['subscriptions'], plat['playstation'],
        'PlayStation Plus Deluxe (12 месяцев)', 'ps-plus-deluxe-12m',
        'Премиальная подписка PS Plus с каталогом классики, демо-версиями и сотнями игр.',
        'Ежемесячные бесплатные игры, сетевой мультиплеер, эксклюзивные скидки и доступ к каталогу игр PS4 и PS5 в высоком разрешении.',
        '1. На консоли перейдите в раздел PS Plus.\n2. Выберите "Погашение ваучера".\n3. Введите цифровой код подписки.',
        4990, 6990, 'Турция / СНГ',
        'https://images.unsplash.com/photo-1507457379470-08b800bebc67?w=800&auto=format&fit=crop&q=80',
        'Выгодно', 4.8, 1750
    );

    insertProd.run(
        cat['subscriptions'], plat['global'],
        'Telegram Premium (12 месяцев подписки)', 'tg-premium-12m',
        'Годовая официальная подписка Telegram Premium в виде подарочного кода.',
        'Удвоенные лимиты каналов, расшифровка голосовых сообщений, загрузка файлов до 4 ГБ, статус эмодзи, максимальная скорость и отсутствие рекламы.',
        '1. Откройте чат с ботом @PremiumBot или перейдите по ссылке активации из письма.\n2. Подтвердите активацию премиум-статуса на ваш аккаунт.',
        2190, 3190, 'Global',
        'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1200&auto=format&fit=crop&q=80',
        'Хит', 5.0, 5200
    );

    // Подарочные карты
    insertProd.run(
        cat['gift-cards'], plat['steam'],
        'Подарочная карта Steam Wallet 1000 ₽', 'steam-card-1000',
        'Моментальное пополнение баланса кошелька Steam для аккаунтов любого региона.',
        'Пополняйте баланс без комиссий. Покупайте игры, скины CS2, боевые пропуска Dota 2 и внутриигровые предметы на Торговой площадке Steam.',
        '1. Откройте Steam -> Баланс кошелька -> Код кошелька Steam.\n2. Введите купленный код.\n3. Средства мгновенно поступят на ваш баланс.',
        1050, 1150, 'Global',
        'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop&q=80',
        'Моментально', 5.0, 6400
    );

    // 4. Наполняем склад лицензионных ключей (License Keys Pool) для каждого товара
    const allProducts = db.prepare('SELECT id, slug FROM products;').all();
    const insertKey = db.prepare('INSERT INTO license_keys (product_id, key_code, is_used) VALUES (?, ?, 0);');

    allProducts.forEach(prod => {
        // Создаем по 5 готовых ключей в пуле для каждого товара
        for (let i = 0; i < 5; i++) {
            insertKey.run(prod.id, generateKey(prod.slug));
        }
    });

    // 5. Промокоды на скидку
    const insertPromo = db.prepare('INSERT INTO promocodes (code, discount_percent, min_order_amount) VALUES (?, ?, ?);');
    insertPromo.run('DIPLOM2026', 15, 0); // 15% скидка для диплома
    insertPromo.run('GAMER', 20, 1000);   // 20% скидка от 1000 руб
    insertPromo.run('START', 10, 0);     // 10% на первый заказ

    // 6. База Знаний / FAQ
    const insertKB = db.prepare('INSERT INTO knowledge_base (category, question, answer, is_staff, sort_order) VALUES (?, ?, ?, ?, ?);');

    // Клиентский FAQ
    insertKB.run(
        'Активация',
        'Как быстро я получу ключ после оплаты?',
        'Ключ активации появляется на вашем экране сразу после подтверждения заказа за 1 секунду. Также он моментально сохраняется в вашем личном кабинете.',
        0, 1
    );
    insertKB.run(
        'Гарантии',
        'Что делать, если ключ не подходит или выдает ошибку?',
        'Все наши ключи закупаются напрямую у официальных издателей и дистрибьюторов. Мы предоставляем 100% гарантию на активацию. В случае технической проблемы техподдержка произведет мгновенную замену ключа или возврат средств.',
        0, 2
    );
    insertKB.run(
        'Оплата',
        'Какие способы оплаты поддерживаются?',
        'Мы принимаем банковские карты МИР, Visa, MasterCard, Систему быстрых платежей (СБП) по QR-коду и кошельки ЮMoney без скрытых комиссий.',
        0, 3
    );
    insertKB.run(
        'Регионы',
        'Что означает регион Global?',
        'Метка Global означает, что цифровой ключ не имеет географических ограничений и может быть активирован в любой точке мира, включая Россию, Беларусь, Казахстан и страны СНГ.',
        0, 4
    );

    // Регламенты для администратора (для диплома)
    insertKB.run(
        'Регламент',
        'Стандарт закупки и верификации цифровых лицензий',
        'Все поступающие партии ключей шифруются и валидируются контрольной суммой перед добавлением в пул license_keys. Минимальный страховой остаток на складе — 3 ключа на позицию.',
        1, 5
    );
    insertKB.run(
        'Безопасность',
        'Политика защиты пользовательских данных и транзакций',
        'Пароли администраторов хранятся исключительно в виде хэшей SHA-256. Выдача ключей логируется с привязкой к уникальному номеру заказа и метке времени.',
        1, 6
    );

    // 7. Создаем демонстрационный заказ
    const insertOrder = db.prepare(`
        INSERT INTO orders (order_number, user_id, customer_email, customer_phone, customer_name, payment_method, promo_code, discount_percent, subtotal, total_price, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    const insertOrderItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, price, quantity, license_key)
        VALUES (?, ?, ?, ?, ?, ?);
    `);

    const demoKey1 = generateKey('CYBER');
    const orderRes = insertOrder.run(
        'KEY-74921', 2, 'alex.gamer@gmail.com', '+7 (999) 123-45-67',
        'Алексей Смирнов', 'СБП (QR-код)', 'DIPLOM2026', 15, 1999, 1699.15, 'completed'
    );
    insertOrderItem.run(orderRes.lastInsertRowid, 1, 'Cyberpunk 2077: Ultimate Edition', 1699.15, 1, demoKey1);

    console.log('✅ База данных KeyStore успешно инициализирована и наполнена стартовыми товарами.');
}

// Запускаем инициализацию базы данных при подключении модуля
initDatabase();

module.exports = {
    db,
    hashPassword,
    generateKey,

    // Справочники
    getCategories() {
        return db.prepare('SELECT * FROM categories ORDER BY sort_order ASC;').all();
    },

    getPlatforms() {
        return db.prepare('SELECT * FROM platforms ORDER BY id ASC;').all();
    },

    // Каталог товаров с расширенной фильтрацией и поиском
    getProducts({ category, platform, search, sort } = {}) {
        let sql = `
            SELECT p.*, c.name as category_name, c.slug as category_slug,
                   pl.name as platform_name, pl.slug as platform_slug, pl.badge_color as platform_color, pl.icon as platform_icon,
                   (SELECT COUNT(*) FROM license_keys WHERE product_id = p.id AND is_used = 0) as stock_count,
                   (SELECT COUNT(*) FROM license_keys WHERE product_id = p.id AND is_used = 0) as in_stock
            FROM products p
            JOIN categories c ON p.category_id = c.id
            JOIN platforms pl ON p.platform_id = pl.id
            WHERE p.is_available = 1
        `;
        const params = [];

        if (category && category !== 'all') {
            sql += ' AND c.slug = ?';
            params.push(category);
        }

        if (platform && platform !== 'all') {
            sql += ' AND pl.slug = ?';
            params.push(platform);
        }

        if (search && search.trim() !== '') {
            sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
            const term = `%${search.trim()}%`;
            params.push(term, term);
        }

        // Сортировка
        if (sort === 'price-asc') {
            sql += ' ORDER BY p.price ASC';
        } else if (sort === 'price-desc') {
            sql += ' ORDER BY p.price DESC';
        } else if (sort === 'rating') {
            sql += ' ORDER BY p.rating DESC';
        } else {
            // По умолчанию — самые популярные
            sql += ' ORDER BY p.sales_count DESC, p.id DESC';
        }

        return db.prepare(sql).all(...params);
    },

    getProductById(id) {
        return db.prepare(`
            SELECT p.*, c.name as category_name, c.slug as category_slug,
                   pl.name as platform_name, pl.slug as platform_slug, pl.badge_color as platform_color, pl.icon as platform_icon,
                   (SELECT COUNT(*) FROM license_keys WHERE product_id = p.id AND is_used = 0) as stock_count,
                   (SELECT COUNT(*) FROM license_keys WHERE product_id = p.id AND is_used = 0) as in_stock
            FROM products p
            JOIN categories c ON p.category_id = c.id
            JOIN platforms pl ON p.platform_id = pl.id
            WHERE p.id = ?;
        `).get(id);
    },

    // Промокоды
    checkPromoCode(code) {
        if (!code || typeof code !== 'string') return null;
        const clean = code.trim().toUpperCase();
        return db.prepare('SELECT * FROM promocodes WHERE code = ? AND is_active = 1;').get(clean);
    },

    // Оформление заказа и выдача ключей (Транзакция)
    createOrder({ customer_email, customer_phone, customer_name, payment_method, promo_code, items }) {
        if (!customer_email || !Array.isArray(items) || items.length === 0) {
            throw new Error('Некорректные данные заказа: email и список товаров обязательны');
        }

        const email = customer_email.trim().toLowerCase();
        const phone = customer_phone ? customer_phone.trim() : '';
        const name = customer_name ? customer_name.trim() : 'Покупатель';
        const payment = payment_method || 'Банковская карта';

        // 1. Рассчитываем сумму заказа и проверяем товары
        let subtotal = 0;
        const resolvedItems = [];

        for (const item of items) {
            const product = db.prepare('SELECT id, name, price, slug FROM products WHERE id = ? AND is_available = 1;').get(item.id);
            if (!product) {
                throw new Error(`Товар с ID ${item.id} не найден или недоступен для покупки`);
            }
            const quantity = Math.min(50, Math.max(1, parseInt(item.quantity) || 1));
            subtotal += product.price * quantity;
            resolvedItems.push({ product, quantity });
        }

        // 2. Проверяем скидку по промокоду с учетом минимальной суммы заказа
        let discountPercent = 0;
        let promoCodeValid = null;
        if (promo_code) {
            const promo = this.checkPromoCode(promo_code);
            if (promo && (!promo.min_order_amount || subtotal >= promo.min_order_amount)) {
                discountPercent = promo.discount_percent;
                promoCodeValid = promo.code;
            }
        }

        const discountMultiplier = (100 - discountPercent) / 100;
        const totalPrice = Math.round(subtotal * discountMultiplier * 100) / 100;

        // 3. Находим или создаем пользователя исключительно по email
        let user = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE;').get(email);
        let userId = user ? user.id : null;
        if (!userId) {
            try {
                const insertUser = db.prepare(`
                    INSERT INTO users (email, phone, name, role)
                    VALUES (?, ?, ?, 'customer');
                `);
                const uRes = insertUser.run(email, phone || null, name);
                userId = uRes.lastInsertRowid;
            } catch (uErr) {
                // Если телефон уже занят или возник конфликт уникальности, создаем без телефона
                const insertUser = db.prepare(`
                    INSERT INTO users (email, phone, name, role)
                    VALUES (?, NULL, ?, 'customer');
                `);
                const uRes = insertUser.run(email, name);
                userId = uRes.lastInsertRowid;
            }
        }

        // 4. Генерируем уникальный номер заказа KEY-XXXXX
        const orderNumber = `KEY-${Math.floor(10000 + Math.random() * 90000)}`;

        // Выполняем транзакцию создания заказа и резервирования ключей
        db.exec('BEGIN TRANSACTION;');

        try {
            const orderStmt = db.prepare(`
                INSERT INTO orders (order_number, user_id, customer_email, customer_phone, customer_name, payment_method, promo_code, discount_percent, subtotal, total_price, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed');
            `);
            const orderRes = orderStmt.run(
                orderNumber, userId, email, phone, name,
                payment, promoCodeValid, discountPercent, subtotal, totalPrice
            );
            const orderId = orderRes.lastInsertRowid;

            const orderItemStmt = db.prepare(`
                INSERT INTO order_items (order_id, product_id, product_name, price, quantity, license_key)
                VALUES (?, ?, ?, ?, ?, ?);
            `);

            const updateKeyStmt = db.prepare(`
                UPDATE license_keys
                SET is_used = 1, order_id = ?, claimed_at = datetime('now', 'localtime')
                WHERE id = ?;
            `);

            const insertNewKeyStmt = db.prepare(`
                INSERT INTO license_keys (product_id, key_code, is_used, order_id, claimed_at)
                VALUES (?, ?, 1, ?, datetime('now', 'localtime'));
            `);

            const updateSalesStmt = db.prepare(`
                UPDATE products SET sales_count = sales_count + ? WHERE id = ?;
            `);

            const issuedKeys = [];

            for (const { product, quantity } of resolvedItems) {
                for (let q = 0; q < quantity; q++) {
                    // Ищем доступный ключ в складе ключей
                    const availableKey = db.prepare(`
                        SELECT id, key_code FROM license_keys
                        WHERE product_id = ? AND is_used = 0
                        LIMIT 1;
                    `).get(product.id);

                    let finalKey = '';

                    if (availableKey) {
                        updateKeyStmt.run(orderId, availableKey.id);
                        finalKey = availableKey.key_code;
                    } else {
                        // Если в демо-режиме ключи кончились, мгновенно генерируем новый лицензионный ключ
                        finalKey = generateKey(product.slug);
                        insertNewKeyStmt.run(product.id, finalKey, orderId);
                    }

                    const itemFinalPrice = Math.round(product.price * discountMultiplier * 100) / 100;
                    orderItemStmt.run(orderId, product.id, product.name, itemFinalPrice, 1, finalKey);

                    issuedKeys.push({
                        productId: product.id,
                        productName: product.name,
                        keyCode: finalKey
                    });
                }

                updateSalesStmt.run(quantity, product.id);
            }

            db.exec('COMMIT;');

            return {
                id: orderId,
                orderNumber,
                customerEmail: email,
                subtotal,
                discountPercent,
                totalPrice,
                status: 'completed',
                keys: issuedKeys
            };
        } catch (err) {
            db.exec('ROLLBACK;');
            throw err;
        }
    },

    // Личный кабинет покупателя: заказы и ключи по email
    getCustomerOrders(email) {
        if (!email) return [];
        const cleanEmail = email.trim().toLowerCase();

        const orders = db.prepare(`
            SELECT id, order_number, customer_email, total_price, promo_code, discount_percent, status, created_at
            FROM orders
            WHERE customer_email = ? COLLATE NOCASE
            ORDER BY id DESC;
        `).all(cleanEmail);

        const getItems = db.prepare(`
            SELECT oi.id, oi.product_id, oi.product_name, oi.price, oi.quantity, oi.license_key,
                   p.image_url, p.activation_guide, pl.name as platform_name
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            JOIN platforms pl ON p.platform_id = pl.id
            WHERE oi.order_id = ?;
        `);

        return orders.map(ord => ({
            ...ord,
            items: getItems.all(ord.id)
        }));
    },

    // Регистрация нового покупателя по Email и паролю
    registerUser({ name, email, password, phone }) {
        if (!email || typeof email !== 'string' || !email.includes('@')) {
            throw new Error('Укажите корректный адрес электронной почты');
        }
        if (!password || typeof password !== 'string' || password.length < 4) {
            throw new Error('Пароль должен содержать не менее 4 символов');
        }

        const cleanEmail = email.trim().toLowerCase();
        let cleanName = (name ? String(name) : cleanEmail.split('@')[0]).trim();
        if (!cleanName) cleanName = cleanEmail.split('@')[0];
        let baseUsername = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
        if (!baseUsername || baseUsername.replace(/_/g, '').length === 0) {
            baseUsername = 'user_' + Math.floor(1000 + Math.random() * 9000);
        }

        const existing = db.prepare('SELECT id, password_hash, username, name, role FROM users WHERE email = ? COLLATE NOCASE;').get(cleanEmail);
        if (existing) {
            if (existing.password_hash) {
                throw new Error('Пользователь с таким email уже зарегистрирован в системе');
            }
            const hash = hashPassword(password);
            let uName = existing.username || baseUsername;
            // Проверяем уникальность логина
            let conflict = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?;').get(uName, existing.id);
            while (conflict) {
                uName = baseUsername + '_' + Math.floor(1000 + Math.random() * 9000);
                conflict = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?;').get(uName, existing.id);
            }
            let uPhone = phone ? String(phone).trim() : null;
            db.prepare('UPDATE users SET name = ?, password_hash = ?, username = ?, phone = COALESCE(phone, ?) WHERE id = ?;')
                .run(cleanName, hash, uName, uPhone, existing.id);
            return {
                id: existing.id,
                username: uName,
                email: cleanEmail,
                name: cleanName,
                role: existing.role || 'customer'
            };
        }

        const hash = hashPassword(password);
        let uName = baseUsername;
        let uPhone = phone ? String(phone).trim() : null;
        let conflict = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE;').get(uName);
        while (conflict) {
            uName = baseUsername + '_' + Math.floor(1000 + Math.random() * 9000);
            conflict = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE;').get(uName);
        }

        const stmt = db.prepare(`
            INSERT INTO users (username, email, phone, name, password_hash, role)
            VALUES (?, ?, ?, ?, ?, 'customer');
        `);

        let res;
        try {
            res = stmt.run(uName, cleanEmail, uPhone, cleanName, hash);
        } catch (e) {
            uName = baseUsername + '_' + Math.floor(Math.random() * 100000);
            try {
                res = stmt.run(uName, cleanEmail, uPhone, cleanName, hash);
            } catch (e2) {
                res = stmt.run(uName, cleanEmail, null, cleanName, hash);
            }
        }

        return {
            id: res.lastInsertRowid,
            username: uName,
            email: cleanEmail,
            name: cleanName,
            role: 'customer'
        };
    },

    // Единая аутентификация пользователей и администраторов по логину/почте и паролю
    authenticateUser(loginOrEmail, password) {
        if (!loginOrEmail || !password) return null;
        const clean = String(loginOrEmail).trim();
        if (!clean) return null;
        const hash = hashPassword(password);

        const user = db.prepare(`
            SELECT id, username, email, name, role
            FROM users
            WHERE (username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE) AND password_hash = ?;
        `).get(clean, clean, hash);

        return user || null;
    },

    // Аутентификация администратора (tpemeri / rqllo)
    adminLogin(login, password) {
        const user = this.authenticateUser(login, password);
        if (user && user.role === 'admin') {
            return user;
        }
        return null;
    },

    // Статистика для панели администратора
    getAdminStats() {
        const totalRevenue = db.prepare('SELECT COALESCE(SUM(total_price), 0) as val FROM orders;').get().val;
        const totalOrders = db.prepare('SELECT COUNT(*) as val FROM orders;').get().val;
        const keysSold = db.prepare('SELECT COUNT(*) as val FROM order_items;').get().val;
        const keysInStock = db.prepare('SELECT COUNT(*) as val FROM license_keys WHERE is_used = 0;').get().val;
        const avgCheck = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

        const topProducts = db.prepare(`
            SELECT p.id, p.name, p.price, p.sales_count, p.image_url, pl.name as platform_name
            FROM products p
            JOIN platforms pl ON p.platform_id = pl.id
            ORDER BY p.sales_count DESC
            LIMIT 5;
        `).all();

        return {
            totalRevenue: Math.round(totalRevenue),
            total_revenue: Math.round(totalRevenue),
            totalOrders,
            total_orders: totalOrders,
            keysSold,
            keys_sold: keysSold,
            keysInStock,
            keys_in_stock: keysInStock,
            avgCheck,
            avg_check: avgCheck,
            topProducts
        };
    },

    // Список всех заказов для администратора
    getAllOrders(limit = 50) {
        const safeLimit = Math.max(1, Math.min(500, parseInt(limit) || 50));
        const orders = db.prepare(`
            SELECT id, order_number, customer_email, customer_name, total_price, payment_method, promo_code, status, created_at
            FROM orders
            ORDER BY id DESC
            LIMIT ?;
        `).all(safeLimit);

        const getItems = db.prepare(`
            SELECT product_name, price, quantity, license_key
            FROM order_items
            WHERE order_id = ?;
        `);

        return orders.map(ord => ({
            ...ord,
            items: getItems.all(ord.id)
        }));
    },

    // Добавление нового цифрового товара
    addProduct(data) {
        const { category_id, platform_id, name, short_desc, description, activation_guide, price, old_price, region, image_url, badge } = data;
        const slug = name.toLowerCase().replace(/[^a-z0-9а-яё]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.floor(Math.random() * 1000);

        const stmt = db.prepare(`
            INSERT INTO products (category_id, platform_id, name, slug, short_desc, description, activation_guide, price, old_price, region, image_url, badge)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `);

        const res = stmt.run(
            category_id, platform_id, name, slug,
            short_desc || '', description, activation_guide || 'Активируйте ключ в клиенте вашей платформы.',
            price, old_price || null, region || 'Global',
            image_url || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800', badge || ''
        );

        return res.lastInsertRowid;
    },

    // Добавление ключей на склад (пакетная загрузка)
    addKeysToStock(productId, keysArray) {
        if (!productId || !Array.isArray(keysArray) || keysArray.length === 0) return 0;
        const stmt = db.prepare('INSERT INTO license_keys (product_id, key_code, is_used) VALUES (?, ?, 0);');
        let count = 0;
        for (const k of keysArray) {
            const clean = String(k).trim();
            if (clean.length > 3) {
                stmt.run(productId, clean);
                count++;
            }
        }
        return count;
    },

    // База Знаний
    getKnowledgeBase(isStaff = 0) {
        if (isStaff) {
            return db.prepare('SELECT * FROM knowledge_base ORDER BY is_staff ASC, sort_order ASC;').all();
        }
        return db.prepare('SELECT * FROM knowledge_base WHERE is_staff = 0 ORDER BY sort_order ASC;').all();
    },

    addKBArticle(category, question, answer, isStaff = 0) {
        const stmt = db.prepare('INSERT INTO knowledge_base (category, question, answer, is_staff, sort_order) VALUES (?, ?, ?, ?, 99);');
        return stmt.run(category, question, answer, isStaff ? 1 : 0).lastInsertRowid;
    },

    // ==========================================
    // СЕССИИ И ТОКЕНЫ АВТОРИЗАЦИИ (RBAC)
    // ==========================================
    createSession(user) {
        if (!user || !user.id) return null;
        const prefix = user.role === 'admin' ? 'admin_' : 'user_';
        const token = prefix + crypto.randomBytes(32).toString('hex');
        db.prepare(`
            INSERT INTO sessions (token, user_id, role, email, username)
            VALUES (?, ?, ?, ?, ?);
        `).run(token, user.id, user.role || 'customer', user.email, user.username || user.name);
        return token;
    },

    getSession(token) {
        if (!token || typeof token !== 'string') return null;
        const session = db.prepare(`
            SELECT s.token, s.user_id, s.role, s.email, s.username, s.created_at, u.name
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?;
        `).get(token);
        if (!session) return null;

        // Сессия действительна 7 дней (TTL)
        if (session.created_at) {
            const created = new Date(String(session.created_at).replace(' ', 'T')).getTime();
            if (!isNaN(created) && (Date.now() - created > 7 * 24 * 60 * 60 * 1000)) {
                this.deleteSession(token);
                return null;
            }
        }
        return session;
    },

    cleanupSessions() {
        return db.prepare("DELETE FROM sessions WHERE datetime(created_at, '+7 days') < datetime('now', 'localtime');").run().changes;
    },

    deleteSession(token) {
        if (!token) return;
        db.prepare('DELETE FROM sessions WHERE token = ?;').run(token);
    },

    // ==========================================
    // УПРАВЛЕНИЕ КАТАЛОГОМ (ОЧИСТКА И АВТОТЕСТЫ)
    // ==========================================
    deleteProduct(id) {
        const prodId = parseInt(id);
        if (!prodId) return false;
        db.prepare('DELETE FROM license_keys WHERE product_id = ?;').run(prodId);
        db.prepare('DELETE FROM order_items WHERE product_id = ?;').run(prodId);
        const res = db.prepare('DELETE FROM products WHERE id = ?;').run(prodId);
        return res.changes > 0;
    },

    cleanupTestProducts() {
        const testProds = db.prepare("SELECT id FROM products WHERE name LIKE 'Тестовая Игра%';").all();
        for (const p of testProds) {
            this.deleteProduct(p.id);
        }
        return testProds.length;
    }
};
