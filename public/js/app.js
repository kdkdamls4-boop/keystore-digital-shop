/**
 * ==============================================================================
 * КЛИЕНТСКИЙ СЦЕНАРИЙ JAVASCRIPT (app.js)
 * Интернет-магазин цифровых товаров и лицензионных ключей «KeyStore»
 * ==============================================================================
 * 
 * Модульная архитектура:
 * 1. Состояние приложения (State Management)
 * 2. Инициализация и загрузка данных с сервера (Fetch API)
 * 3. Фильтрация по категориям, платформам и живой поиск
 * 4. Управление корзиной и расчет скидок по промокоду
 * 5. Мгновенная выдача лицензионных ключей и копирование в буфер
 * 6. Личный кабинет покупателя с историей ключей
 * 7. Интерактивная база знаний (FAQ Accordion)
 */

'use strict';

// ==========================================
// 1. СОСТОЯНИЕ ПРИЛОЖЕНИЯ (STATE)
// ==========================================

const state = {
    products: [],
    categories: [],
    platforms: [],
    activeCategory: 'all',
    activePlatform: 'all',
    searchQuery: '',
    activeSort: 'popular',
    cart: JSON.parse(localStorage.getItem('keystore_cart') || '[]'),
    appliedPromo: null,
    customerEmail: localStorage.getItem('keystore_customer_email') || '',
    currentUser: JSON.parse(localStorage.getItem('keystore_user') || 'null'),
    authToken: localStorage.getItem('keystore_token') || ''
};

// Запуск при полной загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

/**
 * Инициализация ключевых компонентов приложения
 */
async function initApp() {
    setupEventListeners();
    updateCartUI();
    updateCustomerUI();
    updateAuthUI();

    // Загружаем данные с нашего Express REST API
    await Promise.all([
        loadCategories(),
        loadPlatforms(),
        loadProducts(),
        loadFAQ()
    ]);
}

/**
 * Навешивание обработчиков событий
 */
function setupEventListeners() {
    // 1. Корзина
    const cartBtn = document.getElementById('cartBtn');
    if (cartBtn) cartBtn.addEventListener('click', openCart);

    // 2. Личный кабинет
    const userBtn = document.getElementById('userCabinetBtn');
    if (userBtn) userBtn.addEventListener('click', openCabinetModal);

    // 3. Поиск (с задержкой debounce 250 мс)
    const searchInput = document.getElementById('globalSearchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');

    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value;
            clearSearchBtn.style.display = val ? 'block' : 'none';

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                state.searchQuery = val;
                loadProducts();
            }, 250);
        });

        // Горячая клавиша "/" для быстрого перехода в поиск
        window.addEventListener('keydown', (e) => {
            if (e.key === '/' && document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput.focus();
            }
            if (e.key === 'Escape' && document.activeElement === searchInput) {
                searchInput.value = '';
                state.searchQuery = '';
                clearSearchBtn.style.display = 'none';
                loadProducts();
            }
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            state.searchQuery = '';
            clearSearchBtn.style.display = 'none';
            searchInput.focus();
            loadProducts();
        });
    }

    // 4. Сортировка
    const sortSelect = document.getElementById('catalogSortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            state.activeSort = e.target.value;
            loadProducts();
        });
    }

    // 5. Применение промокода
    const applyPromoBtn = document.getElementById('applyPromoBtn');
    if (applyPromoBtn) {
        applyPromoBtn.addEventListener('click', applyPromoCode);
    }

    // Закрытие модальных окон по клику на фон или Escape
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-backdrop')) {
            e.target.classList.remove('active');
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-backdrop.active').forEach(m => m.classList.remove('active'));
        }
    });
}

// ==========================================
// 2. ЗАГРУЗКА ДАННЫХ И КАТАЛОГА (FETCH API)
// ==========================================

/**
 * Загрузка категорий с сервера
 */
async function loadCategories() {
    try {
        const res = await fetch('/api/categories');
        const data = await res.json();
        state.categories = data;

        const container = document.getElementById('categoriesBar');
        if (!container) return;

        let html = `
            <button type="button" class="cat-pill ${state.activeCategory === 'all' ? 'active' : ''}" onclick="filterByCategory('all')">
                <span>⚡ Все категории</span>
            </button>
        `;

        data.forEach(cat => {
            html += `
                <button type="button" class="cat-pill ${state.activeCategory === cat.slug ? 'active' : ''}" onclick="filterByCategory('${cat.slug}')">
                    <span>${cat.icon || '📦'} ${escapeHtml(cat.name)}</span>
                </button>
            `;
        });

        container.innerHTML = html;
    } catch (err) {
        console.error('Ошибка загрузки категорий:', err);
    }
}

/**
 * Загрузка платформ (Steam, PS, Xbox, Windows)
 */
async function loadPlatforms() {
    try {
        const res = await fetch('/api/platforms');
        const data = await res.json();
        state.platforms = data;

        const container = document.getElementById('platformsBar');
        if (!container) return;

        let html = `
            <button type="button" class="plat-chip ${state.activePlatform === 'all' ? 'active' : ''}" onclick="filterByPlatform('all')">
                Все платформы
            </button>
        `;

        data.forEach(plat => {
            html += `
                <button type="button" class="plat-chip ${state.activePlatform === plat.slug ? 'active' : ''}" onclick="filterByPlatform('${plat.slug}')">
                    ${plat.icon || '💻'} ${escapeHtml(plat.name)}
                </button>
            `;
        });

        container.innerHTML = html;
    } catch (err) {
        console.error('Ошибка загрузки платформ:', err);
    }
}

/**
 * Загрузка цифровых товаров с учетом текущих фильтров
 */
async function loadProducts() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    try {
        const params = new URLSearchParams();
        if (state.activeCategory && state.activeCategory !== 'all') params.append('category', state.activeCategory);
        if (state.activePlatform && state.activePlatform !== 'all') params.append('platform', state.activePlatform);
        if (state.searchQuery) params.append('search', state.searchQuery);
        if (state.activeSort) params.append('sort', state.activeSort);

        const res = await fetch(`/api/products?${params.toString()}`);
        const products = await res.json();
        state.products = products;

        renderProducts(products);
    } catch (err) {
        grid.innerHTML = `
            <div class="loading-state">
                <p style="color: var(--danger);">⚠️ Не удалось загрузить каталог товаров. Проверьте соединение с сервером.</p>
            </div>
        `;
    }
}

/**
 * Отрисовка карточек товаров в сетке
 */
function renderProducts(products) {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    if (!Array.isArray(products) || products.length === 0) {
        grid.innerHTML = `
            <div class="loading-state">
                <p>🔍 По вашему запросу ничего не найдено.</p>
                <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 12px;" onclick="resetFilters()">Сбросить фильтры</button>
            </div>
        `;
        return;
    }

    grid.innerHTML = products.map(item => createProductCardHtml(item)).join('');
}

/**
 * Генерация HTML для одной карточки цифрового товара
 */
function createProductCardHtml(item) {
    const cartItem = state.cart.find(c => c.id === item.id);
    const quantity = cartItem ? cartItem.quantity : 0;

    // Бейдж товара
    let badgeHtml = '';
    if (item.badge) {
        let badgeClass = 'badge-hit';
        if (item.badge.includes('Топ')) badgeClass = 'badge-top';
        if (item.badge.includes('Лицензия')) badgeClass = 'badge-license';
        if (item.badge.includes('Скидка') || item.badge.includes('%')) badgeClass = 'badge-discount';
        badgeHtml = `<span class="badge-tag ${badgeClass}">${escapeHtml(item.badge)}</span>`;
    }

    // Кнопка корзины / счетчик количества
    let actionHtml = '';
    if (quantity > 0) {
        actionHtml = `
            <div class="card-counter">
                <button type="button" class="counter-btn" onclick="changeQuantity(${item.id}, -1)">-</button>
                <span class="counter-val">${quantity}</span>
                <button type="button" class="counter-btn" onclick="changeQuantity(${item.id}, 1)">+</button>
            </div>
        `;
    } else {
        actionHtml = `
            <button type="button" class="btn-add-cart" onclick="addToCart(${item.id}, event)">
                + В корзину
            </button>
        `;
    }

    return `
        <article class="product-card" data-id="${item.id}">
            <div class="card-thumb-wrap" onclick="openProductModal(${item.id})">
                <img src="${item.image_url}" alt="${escapeHtml(item.name)}" class="card-thumb" loading="lazy">
                ${badgeHtml}
                <div class="platform-badge">
                    <span>${item.platform_icon || '💻'}</span>
                    <span>${escapeHtml(item.platform_name)}</span>
                </div>
                <div class="region-badge">${escapeHtml(item.region || 'Global')}</div>
            </div>

            <div class="card-body">
                <div class="card-meta-row">
                    <span class="card-category-name">${escapeHtml(item.category_name)}</span>
                    <span class="card-rating">⭐ ${item.rating || '4.9'}</span>
                </div>

                <h3 class="card-title" onclick="openProductModal(${item.id})" title="${escapeHtml(item.name)}">
                    ${escapeHtml(item.name)}
                </h3>

                <p class="card-desc">${escapeHtml(item.short_desc || item.description || '')}</p>

                <div class="card-footer">
                    <div class="card-price-wrap">
                        <span class="card-price">${item.price.toLocaleString('ru-RU')} ₽</span>
                        ${item.old_price ? `<span class="card-old-price">${item.old_price.toLocaleString('ru-RU')} ₽</span>` : ''}
                    </div>
                    <div class="card-actions">
                        ${actionHtml}
                    </div>
                </div>
            </div>
        </article>
    `;
}

// ==========================================
// 3. ФИЛЬТРАЦИЯ И ПЕРЕКЛЮЧЕНИЕ
// ==========================================

function filterByCategory(catSlug) {
    state.activeCategory = catSlug;
    document.querySelectorAll('.cat-pill').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-category') === catSlug || (catSlug === 'all' && !btn.getAttribute('data-category')));
    });
    loadCategories(); // обновить активный класс
    loadProducts();
}

function filterByPlatform(platSlug) {
    state.activePlatform = platSlug;
    document.querySelectorAll('.plat-chip').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-platform') === platSlug);
    });
    loadPlatforms();
    loadProducts();
}

function resetFilters() {
    state.activeCategory = 'all';
    state.activePlatform = 'all';
    state.searchQuery = '';
    const input = document.getElementById('globalSearchInput');
    if (input) input.value = '';
    loadCategories();
    loadPlatforms();
    loadProducts();
}

// ==========================================
// 4. ДЕТАЛЬНАЯ КАРТОЧКА ТОВАРА (MODAL)
// ==========================================

async function openProductModal(id) {
    try {
        const res = await fetch(`/api/products/${id}`);
        if (!res.ok) throw new Error('Товар не найден');
        const item = await res.json();

        const modalTitle = document.getElementById('productModalTitle');
        const modalBody = document.getElementById('productModalBody');

        if (modalTitle) modalTitle.textContent = item.name;

        if (modalBody) {
            modalBody.innerHTML = `
                <div class="product-detail-layout">
                    <div>
                        <img src="${item.image_url}" alt="${escapeHtml(item.name)}" class="product-detail-img">
                    </div>
                    <div>
                        <div class="detail-tags-row">
                            <span class="detail-tag" style="background-color: var(--primary-light); color: var(--primary);">
                                ${item.platform_icon || '💻'} ${escapeHtml(item.platform_name)}
                            </span>
                            <span class="detail-tag" style="background-color: #e2e8f0; color: var(--text-main);">
                                🌐 Регион: ${escapeHtml(item.region || 'Global')}
                            </span>
                            <span class="detail-tag" style="background-color: var(--success-light); color: var(--success);">
                                ⚡ Мгновенная выдача
                            </span>
                        </div>

                        <h2 class="detail-title">${escapeHtml(item.name)}</h2>
                        <p class="detail-desc">${escapeHtml(item.description)}</p>

                        <div class="guide-box">
                            <h4 class="guide-title">🔑 Инструкция по активации:</h4>
                            <div class="guide-text">${escapeHtml(item.activation_guide || 'Ключ активируется в клиенте платформы.')}</div>
                        </div>

                        <div class="detail-price-row">
                            <div>
                                <span class="detail-price">${item.price.toLocaleString('ru-RU')} ₽</span>
                                ${item.old_price ? `<span class="card-old-price" style="margin-left: 8px;">${item.old_price.toLocaleString('ru-RU')} ₽</span>` : ''}
                            </div>
                            <button type="button" class="btn btn-primary btn-lg" onclick="addToCart(${item.id}); closeModal('productModal'); openCart();">
                                Купить сейчас
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        openModal('productModal');
    } catch (err) {
        showToast('Не удалось открыть детали товара: ' + err.message, 'error');
    }
}

function quickBuy(id) {
    addToCart(id);
    openCart();
}

// ==========================================
// 5. УПРАВЛЕНИЕ КОРЗИНОЙ (CART LOGIC)
// ==========================================

function addToCart(productId, event) {
    if (event) event.stopPropagation();

    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    const existing = state.cart.find(c => c.id === productId);
    if (existing) {
        existing.quantity += 1;
    } else {
        state.cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image_url: product.image_url,
            platform_name: product.platform_name,
            quantity: 1
        });
    }

    saveCart();
    updateCartUI();
    renderProducts(state.products);
    showToast(`Товар «${product.name}» добавлен в корзину!`, 'success');
}

function changeQuantity(productId, delta) {
    const item = state.cart.find(c => c.id === productId);
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
        state.cart = state.cart.filter(c => c.id !== productId);
    }

    saveCart();
    updateCartUI();
    renderProducts(state.products);
    renderCartModal();
}

function removeFromCart(productId) {
    state.cart = state.cart.filter(c => c.id !== productId);
    saveCart();
    updateCartUI();
    renderProducts(state.products);
    renderCartModal();
    showToast('Товар удален из корзины', 'info');
}

function saveCart() {
    localStorage.setItem('keystore_cart', JSON.stringify(state.cart));
}

function updateCartUI() {
    const totalCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const badge = document.getElementById('cartCountBadge');
    const totalSumEl = document.getElementById('cartTotalSum');

    if (badge) badge.textContent = totalCount;
    if (totalSumEl) totalSumEl.textContent = `${subtotal.toLocaleString('ru-RU')} ₽`;
}

function openCart() {
    renderCartModal();
    openModal('cartModal');
}

function renderCartModal() {
    const list = document.getElementById('cartItemsList');
    const submitBtn = document.getElementById('submitOrderBtn');
    if (!list) return;

    if (state.cart.length === 0) {
        list.innerHTML = `
            <div class="loading-state" style="padding: 40px 10px;">
                <p>🛒 Ваша корзина пуста</p>
                <small style="color: var(--text-muted);">Выберите цифровую игру или софт в каталоге</small>
            </div>
        `;
        if (submitBtn) submitBtn.disabled = true;
        updateOrderSummary();
        return;
    }

    if (submitBtn) submitBtn.disabled = false;

    list.innerHTML = state.cart.map(item => `
        <div class="cart-item-row">
            <div class="cart-item-info">
                <div class="cart-item-name">${escapeHtml(item.name)}</div>
                <div class="cart-item-price">${item.price.toLocaleString('ru-RU')} ₽ / шт. (${escapeHtml(item.platform_name || '')})</div>
            </div>
            <div class="card-counter">
                <button type="button" class="counter-btn" onclick="changeQuantity(${item.id}, -1)">-</button>
                <span class="counter-val">${item.quantity}</span>
                <button type="button" class="counter-btn" onclick="changeQuantity(${item.id}, 1)">+</button>
            </div>
            <button type="button" class="btn-remove-item" onclick="removeFromCart(${item.id})" title="Удалить">&times;</button>
        </div>
    `).join('');

    // Предзаполняем email и имя из сохраненного состояния
    const emailInput = document.getElementById('orderEmail');
    if (emailInput && !emailInput.value && state.customerEmail) {
        emailInput.value = state.customerEmail;
    }
    const nameInput = document.getElementById('orderName');
    if (nameInput && !nameInput.value && state.currentUser && state.currentUser.name) {
        nameInput.value = state.currentUser.name;
    }

    updateOrderSummary();
}

function updateOrderSummary() {
    const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const subtotalEl = document.getElementById('summarySubtotal');
    const discountRow = document.getElementById('summaryDiscountRow');
    const discountVal = document.getElementById('summaryDiscountVal');
    const totalEl = document.getElementById('summaryTotal');

    if (subtotalEl) subtotalEl.textContent = `${subtotal.toLocaleString('ru-RU')} ₽`;

    let discountAmount = 0;
    if (state.appliedPromo && state.appliedPromo.discount_percent > 0) {
        discountAmount = Math.round(subtotal * (state.appliedPromo.discount_percent / 100));
        if (discountRow) discountRow.style.display = 'flex';
        if (discountVal) discountVal.textContent = `-${discountAmount.toLocaleString('ru-RU')} ₽ (${state.appliedPromo.discount_percent}%)`;
    } else {
        if (discountRow) discountRow.style.display = 'none';
    }

    const total = Math.max(0, subtotal - discountAmount);
    if (totalEl) totalEl.textContent = `${total.toLocaleString('ru-RU')} ₽`;
}

// ==========================================
// 6. ПРОВЕРКА ПРОМОКОДА
// ==========================================

async function applyPromoCode() {
    const input = document.getElementById('promoInput');
    const status = document.getElementById('promoStatusMessage');
    if (!input || !status) return;

    const code = input.value.trim();
    if (!code) {
        status.className = 'promo-status error';
        status.textContent = 'Введите промокод';
        return;
    }

    try {
        const res = await fetch('/api/promocode/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            state.appliedPromo = data;
            status.className = 'promo-status success';
            status.textContent = `Промокод применен! Скидка ${data.discount_percent}%`;
            updateOrderSummary();
            showToast(`Скидка ${data.discount_percent}% успешно активирована!`, 'success');
        } else {
            state.appliedPromo = null;
            status.className = 'promo-status error';
            status.textContent = data.error || 'Промокод не найден';
            updateOrderSummary();
        }
    } catch (err) {
        status.className = 'promo-status error';
        status.textContent = 'Ошибка проверки промокода';
    }
}

function copyPromoCode(code) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
            showToast(`Промокод ${code} скопирован в буфер!`, 'success');
            const promoInput = document.getElementById('promoInput');
            if (promoInput) promoInput.value = code;
        });
    } else {
        showToast(`Промокод: ${code}`, 'info');
    }
}

// ==========================================
// 7. ОФОРМЛЕНИЕ ЗАКАЗА И ВЫДАЧА КЛЮЧЕЙ
// ==========================================

async function submitOrder() {
    const emailInput = document.getElementById('orderEmail');
    const nameInput = document.getElementById('orderName');
    const phoneInput = document.getElementById('orderPhone');
    const paymentRadio = document.querySelector('input[name="paymentMethod"]:checked');
    const submitBtn = document.getElementById('submitOrderBtn');

    if (!emailInput || !emailInput.value.includes('@')) {
        showToast('Пожалуйста, укажите корректный Email для получения ключа', 'error');
        if (emailInput) emailInput.focus();
        return;
    }

    if (state.cart.length === 0) {
        showToast('Корзина пуста', 'error');
        return;
    }

    const payload = {
        customer_email: emailInput.value.trim(),
        customer_name: nameInput ? nameInput.value.trim() : '',
        customer_phone: phoneInput ? phoneInput.value.trim() : '',
        payment_method: paymentRadio ? paymentRadio.value : 'Банковская карта',
        promo_code: state.appliedPromo ? state.appliedPromo.code : null,
        items: state.cart.map(item => ({ id: item.id, quantity: item.quantity }))
    };

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Обработка платежа...';
        }

        const headers = { 'Content-Type': 'application/json' };
        if (state.authToken) {
            headers['Authorization'] = `Bearer ${state.authToken}`;
        }

        const res = await fetch('/api/orders', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok && data.success) {
            // Сохраняем email покупателя в системе
            state.customerEmail = payload.customer_email;
            localStorage.setItem('keystore_customer_email', state.customerEmail);
            updateCustomerUI();

            // Очищаем корзину
            state.cart = [];
            state.appliedPromo = null;
            saveCart();
            updateCartUI();
            renderProducts(state.products);
            closeModal('cartModal');

            // Показываем экран мгновенной выдачи ключей
            displayReceiptModal(data.order);
        } else {
            showToast('Ошибка оформления: ' + (data.error || 'Неизвестная ошибка'), 'error');
        }
    } catch (err) {
        showToast('Ошибка соединения с сервером при оплате: ' + err.message, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Оплатить и получить ключи';
        }
    }
}

/**
 * Отображение экрана мгновенной выдачи купленных лицензионных ключей
 */
function displayReceiptModal(order) {
    const orderNumEl = document.getElementById('receiptOrderNumber');
    const container = document.getElementById('keysIssuedContainer');

    if (orderNumEl) orderNumEl.textContent = `Заказ #${order.orderNumber} • ${order.totalPrice.toLocaleString('ru-RU')} ₽`;

    if (container && Array.isArray(order.keys)) {
        container.innerHTML = order.keys.map((k, idx) => `
            <div class="key-card-block">
                <div class="key-product-name">🎮 ${escapeHtml(k.productName)}</div>
                <div class="key-box-display">
                    <span class="key-code-text" id="keyCodeText_${idx}">${escapeHtml(k.keyCode)}</span>
                    <button type="button" class="btn-copy-key" onclick="copyIssuedKey('${escapeHtml(k.keyCode)}', this)">
                        Скопировать ключ
                    </button>
                </div>
            </div>
        `).join('');
    }

    openModal('receiptModal');
    showToast('Ключи успешно сгенерированы и доступны на экране!', 'success');
}

function copyIssuedKey(keyCode, btn) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(keyCode).then(() => {
            const originalText = btn.textContent;
            btn.textContent = '✓ Скопировано!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('copied');
            }, 2000);
            showToast('Лицензионный ключ скопирован в буфер обмена!', 'success');
        }).catch(() => {
            showToast(`Ключ: ${keyCode}`, 'info');
        });
    } else {
        showToast(`Ключ: ${keyCode}`, 'info');
    }
}

// ==========================================
// 8. ЛИЧНЫЙ КАБИНЕТ ПОКУПАТЕЛЯ
// ==========================================

function updateCustomerUI() {
    const userBtnText = document.getElementById('userBtnText');
    if (userBtnText) {
        userBtnText.textContent = state.customerEmail ? state.customerEmail.split('@')[0] : 'Личный кабинет';
    }
}

function openCabinetModal() {
    closeModal('receiptModal');
    closeModal('cartModal');

    // При попытке гостя открыть «Мои покупки» или «Личный кабинет» запрашивается авторизация с паролем (или регистрация)
    if (!state.currentUser || !state.authToken) {
        openAuthModal('login');
        showToast('Для доступа к покупкам необходимо войти в аккаунт с паролем', 'info');
        return;
    }

    const loginArea = document.getElementById('cabinetLoginForm');
    const ordersArea = document.getElementById('cabinetOrdersArea');

    if (loginArea) loginArea.style.display = 'none';
    if (ordersArea) ordersArea.style.display = 'block';

    openModal('cabinetModal');
    loadCabinetOrders();
}

function cabinetLogout() {
    handleLogout();
    closeModal('cabinetModal');
}

async function loadCabinetOrders() {
    const list = document.getElementById('cabinetOrdersList');
    const emailLabel = document.getElementById('cabinetUserEmail');
    const userEmail = (state.currentUser && state.currentUser.email) || state.customerEmail;
    if (emailLabel) emailLabel.textContent = userEmail;
    if (!list) return;

    if (!state.authToken) {
        openAuthModal('login');
        return;
    }

    list.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Загрузка ваших цифровых ключей...</p>
        </div>
    `;

    try {
        const res = await fetch('/api/customer/orders', {
            headers: {
                'Authorization': `Bearer ${state.authToken}`
            }
        });

        if (res.status === 401) {
            handleLogout();
            showToast('Сессия авторизации истекла. Войдите снова с паролем', 'error');
            closeModal('cabinetModal');
            openAuthModal('login');
            return;
        }

        const orders = await res.json();

        if (!Array.isArray(orders) || orders.length === 0) {
            list.innerHTML = `
                <div class="loading-state" style="padding: 30px;">
                    <p>Пока нет оформленных заказов на этот адрес.</p>
                    <small>Все ключи, купленные с указанием ${escapeHtml(userEmail)}, будут сохраняться здесь.</small>
                </div>
            `;
            return;
        }

        list.innerHTML = orders.map((ord, ordIdx) => `
            <div class="cabinet-order-card">
                <div class="order-card-header">
                    <div>
                        <span class="order-card-num">Заказ #${escapeHtml(ord.order_number)}</span>
                        <span style="margin-left: 10px; font-weight: 700; color: var(--primary);">${ord.total_price.toLocaleString('ru-RU')} ₽</span>
                    </div>
                    <span class="order-card-date">${ord.created_at || ''}</span>
                </div>

                <div class="order-card-items">
                    ${ord.items.map((it, itemIdx) => {
                        const keyId = `cabinet_key_${ordIdx}_${itemIdx}`;
                        return `
                        <div class="key-box-display" style="background-color: var(--bg-page); margin-top: 8px;">
                            <div style="flex: 1; min-width: 0;">
                                <strong style="display: block; font-size: 0.95rem; margin-bottom: 6px;">🎮 ${escapeHtml(it.product_name)}</strong>
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span class="key-code-text key-masked" id="${keyId}" data-real-key="${escapeHtml(it.license_key)}" data-masked="true">••••-••••-••••-••••</span>
                                    <button type="button" class="btn-toggle-key-eye" onclick="toggleKeyVisibility('${keyId}')" title="Показать/скрыть ключ" aria-label="Показать/скрыть ключ">
                                        👁️
                                    </button>
                                </div>
                            </div>
                            <button type="button" class="btn-copy-key" onclick="copyIssuedKey('${escapeHtml(it.license_key)}', this)" title="Безопасно скопировать ключ">
                                📋 Скопировать
                            </button>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `).join('');
    } catch (err) {
        list.innerHTML = `<p style="color: var(--danger);">Ошибка загрузки заказов: ${err.message}</p>`;
    }
}

function toggleKeyVisibility(keyId) {
    const keyEl = document.getElementById(keyId);
    if (!keyEl) return;
    const isMasked = keyEl.getAttribute('data-masked') === 'true';
    const realKey = keyEl.getAttribute('data-real-key');
    const eyeBtn = keyEl.parentElement ? keyEl.parentElement.querySelector('.btn-toggle-key-eye') : null;

    if (isMasked) {
        keyEl.textContent = realKey;
        keyEl.classList.remove('key-masked');
        keyEl.setAttribute('data-masked', 'false');
        if (eyeBtn) eyeBtn.textContent = '🙈';
    } else {
        keyEl.textContent = '••••-••••-••••-••••';
        keyEl.classList.add('key-masked');
        keyEl.setAttribute('data-masked', 'true');
        if (eyeBtn) eyeBtn.textContent = '👁️';
    }
}

// ==========================================
// 9. БАЗА ЗНАНИЙ (FAQ ACCORDION)
// ==========================================

async function loadFAQ() {
    const container = document.getElementById('faqAccordion');
    if (!container) return;

    try {
        const res = await fetch('/api/kb');
        const articles = await res.json();

        if (!Array.isArray(articles) || articles.length === 0) return;

        container.innerHTML = articles.map((art, idx) => `
            <div class="faq-item ${idx === 0 ? 'active' : ''}">
                <button type="button" class="faq-question-btn" onclick="toggleFaq(this)">
                    <span>${escapeHtml(art.question)}</span>
                    <span class="faq-chevron">▼</span>
                </button>
                <div class="faq-answer">
                    ${escapeHtml(art.answer)}
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.warn('Не удалось загрузить Базу Знаний:', err);
    }
}

function toggleFaq(btn) {
    const item = btn.closest('.faq-item');
    if (!item) return;

    const isActive = item.classList.contains('active');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));

    if (!isActive) {
        item.classList.add('active');
    }
}

// ==========================================
// 10. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И УВЕДОМЛЕНИЯ
// ==========================================

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✓';
    if (type === 'error') icon = '✕';

    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==========================================
// 11. АУТЕНТИФИКАЦИЯ И РЕГИСТРАЦИЯ ПОЛЬЗОВАТЕЛЕЙ
// ==========================================

function updateAuthUI() {
    const nav = document.getElementById('headerAuthNav');
    if (!nav) return;

    if (state.currentUser && state.currentUser.role === 'admin') {
        // Режим администратора: доступна панель управления
        nav.innerHTML = `
            <span style="font-size: 0.88rem; font-weight: 700; color: var(--primary); padding: 6px 12px; background: rgba(0,113,227,0.08); border-radius: var(--radius-sm); border: 1px solid rgba(0,113,227,0.2);">
                🛡️ ${escapeHtml(state.currentUser.username || 'tpemeri')} (Админ)
            </span>
            <button type="button" class="btn btn-primary header-btn" id="openAdminBtn" onclick="openAdminModal()">
                ⚙️ Панель управления
            </button>
            <button type="button" class="btn btn-ghost header-btn" onclick="handleLogout()" title="Выйти из аккаунта">
                🚪 Выйти
            </button>
        `;
    } else if (state.currentUser) {
        // Режим авторизованного покупателя
        nav.innerHTML = `
            <button type="button" class="btn btn-ghost header-btn" onclick="openCabinetModal()">
                👤 ${escapeHtml(state.currentUser.name || state.currentUser.email)}
            </button>
            <button type="button" class="btn btn-ghost header-btn" onclick="handleLogout()" title="Выйти из аккаунта">
                🚪 Выйти
            </button>
        `;
    } else {
        // Гостевой режим (не авторизован)
        nav.innerHTML = `
            <button type="button" class="btn btn-ghost header-btn" onclick="openAuthModal('login')">
                🔑 Войти
            </button>
            <button type="button" class="btn btn-secondary header-btn" onclick="openAuthModal('register')">
                Регистрация
            </button>
        `;
    }
}

function openAuthModal(tab = 'login') {
    switchAuthTab(tab);
    openModal('authModal');

    // Предзаполняем поля ввода сохраненным адресом почты покупателя
    if (state.customerEmail) {
        const loginInput = document.getElementById('authLoginInput');
        if (loginInput && !loginInput.value) {
            loginInput.value = state.customerEmail;
        }
        const regEmailInput = document.getElementById('regEmailInput');
        if (regEmailInput && !regEmailInput.value) {
            regEmailInput.value = state.customerEmail;
        }
    }
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById('authLoginForm');
    const regForm = document.getElementById('authRegisterForm');
    const tabLoginBtn = document.getElementById('tabAuthLoginBtn');
    const tabRegBtn = document.getElementById('tabAuthRegisterBtn');
    const title = document.getElementById('authModalTitle');

    if (tab === 'login') {
        if (loginForm) loginForm.style.display = 'block';
        if (regForm) regForm.style.display = 'none';
        if (tabLoginBtn) tabLoginBtn.classList.add('active');
        if (tabRegBtn) tabRegBtn.classList.remove('active');
        if (title) title.textContent = 'Вход в аккаунт';
    } else {
        if (loginForm) loginForm.style.display = 'none';
        if (regForm) regForm.style.display = 'block';
        if (tabLoginBtn) tabLoginBtn.classList.remove('active');
        if (tabRegBtn) tabRegBtn.classList.add('active');
        if (title) title.textContent = 'Регистрация по почте';
    }
}

async function handleAuthLogin(event) {
    if (event) event.preventDefault();

    const loginInput = document.getElementById('authLoginInput');
    const passInput = document.getElementById('authPasswordInput');

    const login = loginInput ? loginInput.value.trim() : '';
    const password = passInput ? passInput.value.trim() : '';

    if (!login || !password) {
        showToast('Введите логин или email и пароль', 'error');
        return;
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login, password })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            state.currentUser = data.user;
            state.customerEmail = data.user.email;
            state.authToken = data.token || '';
            localStorage.setItem('keystore_user', JSON.stringify(data.user));
            localStorage.setItem('keystore_customer_email', data.user.email);
            localStorage.setItem('keystore_token', state.authToken);

            // Синхронизируем поля оформления заказа
            const orderEmail = document.getElementById('orderEmail');
            if (orderEmail) orderEmail.value = data.user.email;
            const orderName = document.getElementById('orderName');
            if (orderName && data.user.name) orderName.value = data.user.name;

            updateAuthUI();
            updateCustomerUI();
            closeModal('authModal');

            if (data.role === 'admin') {
                showToast(`Добро пожаловать, администратор ${data.user.username || 'tpemeri'}!`, 'success');
                openAdminModal();
            } else {
                showToast(`Добро пожаловать, ${data.user.name}!`, 'success');
            }
        } else {
            showToast(data.error || 'Неверный логин или пароль', 'error');
        }
    } catch (err) {
        console.error('Login error:', err);
        showToast('Ошибка сетевого соединения с сервером', 'error');
    }
}

async function handleAuthRegister(event) {
    if (event) event.preventDefault();

    const name = document.getElementById('regNameInput').value.trim();
    const email = document.getElementById('regEmailInput').value.trim();
    const password = document.getElementById('regPasswordInput').value.trim();
    const confirmPass = document.getElementById('regConfirmPasswordInput').value.trim();

    if (!name || !email || !password) {
        showToast('Заполните все обязательные поля', 'error');
        return;
    }

    if (password !== confirmPass) {
        showToast('Введенные пароли не совпадают', 'error');
        return;
    }

    if (password.length < 4) {
        showToast('Пароль должен содержать минимум 4 символа', 'error');
        return;
    }

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            state.currentUser = data.user;
            state.customerEmail = data.user.email;
            state.authToken = data.token || '';
            localStorage.setItem('keystore_user', JSON.stringify(data.user));
            localStorage.setItem('keystore_customer_email', data.user.email);
            localStorage.setItem('keystore_token', state.authToken);

            // Синхронизируем поля оформления заказа
            const orderEmail = document.getElementById('orderEmail');
            if (orderEmail) orderEmail.value = data.user.email;
            const orderName = document.getElementById('orderName');
            if (orderName && data.user.name) orderName.value = data.user.name;

            updateAuthUI();
            updateCustomerUI();
            closeModal('authModal');
            showToast('Регистрация успешно пройдена! Добро пожаловать!', 'success');
        } else {
            showToast(data.error || 'Ошибка при регистрации', 'error');
        }
    } catch (err) {
        console.error('Registration error:', err);
        showToast('Ошибка сетевого соединения', 'error');
    }
}

function handleLogout() {
    state.currentUser = null;
    state.authToken = '';
    state.customerEmail = '';
    localStorage.removeItem('keystore_user');
    localStorage.removeItem('keystore_token');
    localStorage.removeItem('keystore_customer_email');

    // Очищаем формы и историю заказов в DOM для предотвращения утечки данных
    const emailInput = document.getElementById('orderEmail');
    if (emailInput) emailInput.value = '';
    const nameInput = document.getElementById('orderName');
    if (nameInput) nameInput.value = '';
    const phoneInput = document.getElementById('orderPhone');
    if (phoneInput) phoneInput.value = '';
    const cabinetList = document.getElementById('cabinetOrdersList');
    if (cabinetList) cabinetList.innerHTML = '';

    closeModal('adminModal');
    closeModal('cabinetModal');
    updateAuthUI();
    updateCustomerUI();
    showToast('Вы вышли из учетной записи', 'info');
}

// ==========================================
// 12. ПАНЕЛЬ УПРАВЛЕНИЯ АДМИНИСТРАТОРА (tpemeri)
// ==========================================

function openAdminModal() {
    // Строгая проверка прав доступа: только роль admin
    if (!state.currentUser || state.currentUser.role !== 'admin') {
        showToast('Доступ запрещен. Панель доступна только администратору tpemeri', 'error');
        return;
    }

    openModal('adminModal');
    loadAdminStats();
    loadAdminOrders();
    loadCategoriesAndPlatformsForAdmin();
    loadProductsForKeys();
    loadAdminKB();
}

function switchAdminTab(tabName) {
    const tabs = {
        'orders': document.getElementById('tabOrders'),
        'add-product': document.getElementById('tabAddProduct'),
        'add-keys': document.getElementById('tabAddKeys'),
        'kb': document.getElementById('tabKB')
    };

    Object.values(tabs).forEach(tab => {
        if (tab) tab.style.display = 'none';
    });

    if (tabs[tabName]) {
        tabs[tabName].style.display = 'block';
    }

    const buttons = document.querySelectorAll('.admin-nav-btn');
    buttons.forEach(btn => {
        const clickAttr = btn.getAttribute('onclick') || '';
        if (clickAttr.includes(`'${tabName}'`)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    if (tabName === 'orders') loadAdminOrders();
    if (tabName === 'add-keys') loadProductsForKeys();
    if (tabName === 'kb') loadAdminKB();
}

async function loadAdminStats() {
    try {
        const headers = state.authToken ? { 'Authorization': `Bearer ${state.authToken}` } : {};
        const res = await fetch('/api/admin/stats', { headers });
        const data = await res.json();

        if (res.ok) {
            const revenue = data.totalRevenue ?? data.total_revenue ?? 0;
            const orders = data.totalOrders ?? data.total_orders ?? 0;
            const sold = data.keysSold ?? data.keys_sold ?? 0;
            const stock = data.keysInStock ?? data.keys_in_stock ?? 0;

            const revEl = document.getElementById('kpiRevenue');
            const ordEl = document.getElementById('kpiOrders');
            const soldEl = document.getElementById('kpiKeysSold');
            const stockEl = document.getElementById('kpiKeysStock');

            if (revEl) revEl.textContent = `${Number(revenue).toLocaleString('ru-RU')} ₽`;
            if (ordEl) ordEl.textContent = orders;
            if (soldEl) soldEl.textContent = sold;
            if (stockEl) stockEl.textContent = stock;
        }
    } catch (err) {
        console.error('Error fetching admin stats:', err);
    }
}

async function loadAdminOrders() {
    const tbody = document.getElementById('adminOrdersTbody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">Загрузка заказов...</td></tr>`;

    try {
        const headers = state.authToken ? { 'Authorization': `Bearer ${state.authToken}` } : {};
        const res = await fetch('/api/admin/orders', { headers });
        const orders = await res.json();

        if (!orders || orders.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">Заказов пока нет.</td></tr>`;
            return;
        }

        tbody.innerHTML = orders.map(order => {
            const dateStr = new Date(order.created_at).toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            const total = order.total_price ?? order.total_amount ?? 0;

            const itemsHtml = (order.items || []).map(item => `
                <div style="margin-bottom: 6px; font-size: 0.86rem;">
                    <b>${escapeHtml(item.product_name || item.product_title || 'Цифровой товар')}</b>: 
                    <span class="key-pool-pill" onclick="copyKeyText('${escapeHtml(item.license_key)}')" title="Кликните для копирования" style="cursor: pointer;">
                        🔑 ${escapeHtml(item.license_key)}
                    </span>
                </div>
            `).join('');

            return `
                <tr>
                    <td><b>#${escapeHtml(order.order_number || String(order.id))}</b></td>
                    <td>
                        <span style="font-weight: 600;">${escapeHtml(order.customer_email)}</span>
                        ${order.customer_phone ? `<br><small style="color: var(--text-muted);">${escapeHtml(order.customer_phone)}</small>` : ''}
                    </td>
                    <td><b style="color: var(--primary);">${Number(total).toLocaleString('ru-RU')} ₽</b></td>
                    <td><span class="badge" style="background:#e0f2fe; color:#0369a1;">${escapeHtml(order.payment_method || 'Онлайн')}</span></td>
                    <td>${itemsHtml || '<span style="color: var(--text-muted);">—</span>'}</td>
                    <td><small style="color: var(--text-muted);">${dateStr}</small></td>
                    <td><span class="badge badge-success">${escapeHtml(order.status || 'Выполнен')}</span></td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error fetching admin orders:', err);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 20px;">Ошибка загрузки реестра</td></tr>`;
    }
}

async function loadCategoriesAndPlatformsForAdmin() {
    try {
        const [catsRes, platsRes] = await Promise.all([
            fetch('/api/categories'),
            fetch('/api/platforms')
        ]);
        const categories = await catsRes.json();
        const platforms = await platsRes.json();

        const catSelect = document.getElementById('prodCategorySelect');
        const platSelect = document.getElementById('prodPlatformSelect');

        if (catSelect && categories.length) {
            catSelect.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
        if (platSelect && platforms.length) {
            platSelect.innerHTML = platforms.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        }
    } catch (err) {
        console.error('Error loading cats/plats for admin:', err);
    }
}

async function handleAddProduct(event) {
    if (event) event.preventDefault();

    const title = document.getElementById('prodNameInput').value.trim();
    const payload = {
        category_id: parseInt(document.getElementById('prodCategorySelect').value),
        platform_id: parseInt(document.getElementById('prodPlatformSelect').value),
        name: title,
        title: title,
        price: parseFloat(document.getElementById('prodPriceInput').value),
        old_price: document.getElementById('prodOldPriceInput').value ? parseFloat(document.getElementById('prodOldPriceInput').value) : null,
        region: document.getElementById('prodRegionInput').value.trim() || 'Global',
        badge: document.getElementById('prodBadgeInput').value.trim() || null,
        image_url: document.getElementById('prodImageInput').value.trim() || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800',
        short_desc: document.getElementById('prodShortDescInput').value.trim(),
        description: document.getElementById('prodDescInput').value.trim() || title,
        activation_guide: document.getElementById('prodGuideInput').value.trim()
    };

    if (!payload.name || isNaN(payload.price)) {
        showToast('Заполните обязательные поля (название и цена)', 'error');
        return;
    }

    try {
        const headers = {
            'Content-Type': 'application/json',
            ...(state.authToken ? { 'Authorization': `Bearer ${state.authToken}` } : {})
        };
        const res = await fetch('/api/admin/products', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok) {
            showToast(`Товар "${payload.name}" успешно опубликован!`, 'success');
            document.getElementById('addProductForm').reset();
            loadProductsForKeys();
            loadAdminStats();
            loadProducts(); // обновляем каталог на витрине
        } else {
            showToast(data.error || 'Ошибка при добавлении товара', 'error');
        }
    } catch (err) {
        console.error('Error adding product:', err);
        showToast('Сетевая ошибка при добавлении товара', 'error');
    }
}

async function loadProductsForKeys() {
    const select = document.getElementById('keysProductSelect');
    if (!select) return;

    try {
        const res = await fetch('/api/products');
        const products = await res.json();
        if (products && products.length) {
            select.innerHTML = products.map(p => `
                <option value="${p.id}">${escapeHtml(p.name)} (${p.platform_name || 'Global'}) — ${p.price} ₽</option>
            `).join('');
        }
    } catch (err) {
        console.error('Error loading products for keys select:', err);
    }
}

function generateDemoKeysForStock() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const keys = [];

    for (let i = 0; i < 5; i++) {
        const block = () => Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        keys.push(`${block()}-${block()}-${block()}-${block()}`);
    }

    const textarea = document.getElementById('keysTextarea');
    if (textarea) {
        textarea.value = keys.join('\n');
        showToast('Сгенерировано 5 тестовых лицензионных ключей', 'info');
    }
}

async function handleAddKeys(event) {
    if (event) event.preventDefault();

    const productId = parseInt(document.getElementById('keysProductSelect').value);
    const text = document.getElementById('keysTextarea').value.trim();

    if (!productId || !text) {
        showToast('Выберите товар и введите ключи', 'error');
        return;
    }

    const keys = text.split('\n').map(k => k.trim()).filter(k => k.length > 0);
    if (keys.length === 0) {
        showToast('Список ключей пуст', 'error');
        return;
    }

    try {
        const headers = {
            'Content-Type': 'application/json',
            ...(state.authToken ? { 'Authorization': `Bearer ${state.authToken}` } : {})
        };
        const res = await fetch('/api/admin/keys', {
            method: 'POST',
            headers,
            body: JSON.stringify({ product_id: productId, keys })
        });
        const data = await res.json();

        if (res.ok) {
            showToast(`Успешно загружено ключей: ${data.addedCount || keys.length}!`, 'success');
            document.getElementById('keysTextarea').value = '';
            loadAdminStats();
            loadProducts();
        } else {
            showToast(data.error || 'Ошибка при загрузке ключей', 'error');
        }
    } catch (err) {
        console.error('Error adding keys:', err);
        showToast('Сетевая ошибка при загрузке ключей', 'error');
    }
}

async function loadAdminKB() {
    const container = document.getElementById('adminKBList');
    if (!container) return;

    try {
        const headers = state.authToken ? { 'Authorization': `Bearer ${state.authToken}` } : {};
        const res = await fetch('/api/admin/kb', { headers });
        const articles = await res.json();

        if (!articles || articles.length === 0) {
            container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">В Базе Знаний пока нет статей.</p>`;
            return;
        }

        container.innerHTML = articles.map(a => `
            <div style="background: var(--bg-subtle); border-radius: var(--radius-sm); padding: 14px 16px; margin-bottom: 12px; border: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <b style="color: var(--text-main); font-size: 0.95rem;">${escapeHtml(a.question)}</b>
                    <div>
                        <span class="badge" style="margin-right: 6px;">${escapeHtml(a.category || 'Общее')}</span>
                        ${a.is_staff ? '<span class="badge" style="background:#fee2e2; color:#991b1b;">Внутренний регламент</span>' : '<span class="badge badge-success">Клиентский FAQ</span>'}
                    </div>
                </div>
                <div style="font-size: 0.88rem; color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap;">${escapeHtml(a.answer)}</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Error loading admin KB:', err);
    }
}

async function handleAddKB(event) {
    if (event) event.preventDefault();

    const category = document.getElementById('kbCategoryInput').value.trim();
    const is_staff = parseInt(document.getElementById('kbStaffSelect').value) || 0;
    const question = document.getElementById('kbQuestionInput').value.trim();
    const answer = document.getElementById('kbAnswerInput').value.trim();

    if (!question || !answer) {
        showToast('Заполните вопрос и текст статьи', 'error');
        return;
    }

    try {
        const headers = {
            'Content-Type': 'application/json',
            ...(state.authToken ? { 'Authorization': `Bearer ${state.authToken}` } : {})
        };
        const res = await fetch('/api/admin/kb', {
            method: 'POST',
            headers,
            body: JSON.stringify({ category, is_staff, question, answer })
        });
        const data = await res.json();

        if (res.ok) {
            showToast('Статья добавлена в Базу Знаний!', 'success');
            document.getElementById('addKBForm').reset();
            loadAdminKB();
            loadFAQ();
        } else {
            showToast(data.error || 'Ошибка при сохранении статьи', 'error');
        }
    } catch (err) {
        console.error('Error adding KB article:', err);
        showToast('Сетевая ошибка при сохранении статьи', 'error');
    }
}

function copyKeyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(`Ключ скопирован: ${text}`, 'success');
        }).catch(() => {
            showToast('Не удалось скопировать ключ', 'error');
        });
    } else {
        showToast(`Ключ: ${text}`, 'info');
    }
}

// Экспорт для глобального использования
window.filterByCategory = filterByCategory;
window.filterByPlatform = filterByPlatform;
window.resetFilters = resetFilters;
window.openProductModal = openProductModal;
window.quickBuy = quickBuy;
window.addToCart = addToCart;
window.changeQuantity = changeQuantity;
window.removeFromCart = removeFromCart;
window.openCart = openCart;
window.applyPromoCode = applyPromoCode;
window.copyPromoCode = copyPromoCode;
window.submitOrder = submitOrder;
window.copyIssuedKey = copyIssuedKey;
window.toggleKeyVisibility = toggleKeyVisibility;
window.openCabinetModal = openCabinetModal;
window.cabinetLogout = cabinetLogout;
window.toggleFaq = toggleFaq;
window.openModal = openModal;
window.closeModal = closeModal;
window.openAuthModal = openAuthModal;
window.switchAuthTab = switchAuthTab;
window.handleAuthLogin = handleAuthLogin;
window.handleAuthRegister = handleAuthRegister;
window.handleLogout = handleLogout;
window.openAdminModal = openAdminModal;
window.switchAdminTab = switchAdminTab;
window.loadAdminStats = loadAdminStats;
window.loadAdminOrders = loadAdminOrders;
window.handleAddProduct = handleAddProduct;
window.generateDemoKeysForStock = generateDemoKeysForStock;
window.handleAddKeys = handleAddKeys;
window.handleAddKB = handleAddKB;
window.copyKeyText = copyKeyText;

