// Load shared head from head.html
async function loadSharedHead(path = './assets/head.html') {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Failed to load shared head: ${response.status}`);

    const html = await response.text();
    const parsed = new DOMParser().parseFromString(`<head>${html}</head>`, 'text/html');
    const incomingNodes = [...parsed.head.children];

    incomingNodes.forEach(node => {
      const cloned = node.cloneNode(true);

      if (cloned.tagName === 'TITLE') {
        document.title = cloned.textContent || document.title;
        return;
      }

      const signature = cloned.outerHTML;
      const exists = [...document.head.children].some(
        existing => existing.outerHTML === signature
      );
      if (!exists) {
        document.head.appendChild(cloned);
      }
    });
  } catch (error) {
    console.error(error);
  }
}

// HTML includes for header/footer (data-include="header.html"/"footer.html")
async function includeHtmlFragments() {
  const targets = document.querySelectorAll('[data-include]');
  const promises = [];

  targets.forEach(target => {
    const src = target.getAttribute('data-include');
    if (!src) return;

    const p = fetch(src, { cache: 'no-store' })
      .then(resp => {
        if (!resp.ok) throw new Error(`Failed to load ${src}: ${resp.status}`);
        return resp.text();
      })
      .then(html => {
        target.innerHTML = html;
      })
      .catch(err => console.error(err));

    promises.push(p);
  });

  return Promise.all(promises);

}

const CART_STORAGE_KEY = 'intermission_cart';
const CHECKOUT_URL = 'https://intermissionrec.com/shop/checkout';
const CREATE_PAYMENT_INTENT_URL = 'https://intermissionrec.com/shop/create-payment-intent';
const COD_CHECKOUT_URL = 'https://intermissionrec.com/shop/cod-checkout';
const MAGAZIN_URL = '/magazin';

const STRIPE_PUBLISHABLE_KEY = 'pk_live_51UAP0oIuDHaNKWjE9f7TXsMmx7PRU5exky3pdPzFAh9ULsDIKxFEOYtbvfmmk8gKdJTJvrcfdA0Ww59biESq9PIy00zGj0PeP3';

const SPEEDY_TARIFF_EUR = [
  { maxKg: 3,    office: 3.42, addressAddOn: 2.54 },
  { maxKg: 6,    office: 3.71, addressAddOn: 4.24 },
  { maxKg: 10,   office: 4.57, addressAddOn: 4.24 },
  { maxKg: 20,   office: 8.16, addressAddOn: 5.94 },
  { maxKg: 31.5, office: 8.16, perKgOverPrevTier: 0.35, addressAddOn: 8.45 }
];
const SPEEDY_MAX_KG = 31.5;

function calcCartWeightKg(CATALOG, ids) {
  return ids.reduce((sum, id) => {
    const product = CATALOG[id];
    if (product && product.digital) return sum; // digital items never ship, never weigh
    const unitKg = product && Number(product.weight) > 0 ? Number(product.weight) : 0.3;
    return sum + unitKg * (cart[id] || 0);
  }, 0);
}

function calcSpeedyDeliveryFeeEur(weightKg, deliveryMethod) {
  const capped = Math.min(Math.max(0.01, Number(weightKg) || 0.3), SPEEDY_MAX_KG);
  const tier = SPEEDY_TARIFF_EUR.find((t) => capped <= t.maxKg) || SPEEDY_TARIFF_EUR[SPEEDY_TARIFF_EUR.length - 1];
  let officeEur = tier.office;
  if (tier.perKgOverPrevTier && capped > 20) officeEur += (capped - 20) * tier.perKgOverPrevTier;
  return deliveryMethod === 'office' ? officeEur : officeEur + tier.addressAddOn;
}

let cart = loadCart();
let magazinCatalog = null; // {id: {name, price, image, digital}} once loaded - null until then

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveCart() {
  try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch (e) {}
  updateCartBadges();
}

function formatEur(amount) {
  const fixed = amount.toFixed(2);
  return (fixed.slice(-3) === '.00' ? fixed.slice(0, -3) : fixed) + ' €';
}

// Raw quantity total, no catalog needed - safe to call on every page
// on every load. Used for both the nav badge and /magazin's own
// heading button, so they always agree with each other.
function readCartCount() {
  return Object.values(cart).reduce((sum, qty) => {
    const n = Number(qty);
    return sum + (n > 0 ? n : 0);
  }, 0);
}

function updateCartBadges() {
  const count = readCartCount();
  const navBadge = document.getElementById('navCartCount');
  const navLink = document.querySelector('.nav a.nav-cart');
  if (navBadge) navBadge.textContent = count;
  if (navLink) navLink.classList.toggle('has-items', count > 0);

  // /magazin's own "Кошница (n)" button near the heading, if present
  // on this page - kept in sync the same way, no separate script needed.
  const pageBadge = document.getElementById('cartCount');
  if (pageBadge) pageBadge.textContent = count;
}
// Exposed for the rare case something outside this file needs to
// force a badge refresh (none currently, but cheap to keep public).
window.updateNavCartCount = updateCartBadges;

// Catches the cart changing in *another* tab/page of the site (the
// 'storage' event never fires for the tab that made the write
// itself, only other same-origin tabs/windows) - same-tab updates go
// through saveCart() -> updateCartBadges() directly instead.
window.addEventListener('storage', (e) => {
  if (e.key === CART_STORAGE_KEY) {
    cart = loadCart();
    updateCartBadges();
    renderCartDrawer();
  }
});

// Parses the #magazin-catalog block if it's present on THIS page
// (only true on /magazin itself) - returns null everywhere else.
function getInlineCatalog() {
  const el = document.getElementById('magazin-catalog');
  if (!el) return null;
  try {
    const parsed = JSON.parse(el.textContent);
    return (parsed && parsed.items) || {};
  } catch (e) {
    console.error('Magazin catalog parse failed', e);
    return {};
  }
}

// Resolves the catalog, synchronously when possible (cached, or this
// is /magazin itself) and via a background fetch of /magazin
// otherwise - callback runs exactly once either way.
function ensureCatalog(callback) {
  if (magazinCatalog) { callback(magazinCatalog); return; }
  const inline = getInlineCatalog();
  if (inline) {
    magazinCatalog = inline;
    reconcileCartWithCatalog(magazinCatalog);
    callback(magazinCatalog);
    return;
  }
  fetch(MAGAZIN_URL, { cache: 'no-store' })
    .then(res => {
      if (!res.ok) throw new Error('Failed to load shop catalog: ' + res.status);
      return res.text();
    })
    .then(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const el = doc.getElementById('magazin-catalog');
      const parsed = el ? JSON.parse(el.textContent) : null;
      magazinCatalog = (parsed && parsed.items) || {};
      reconcileCartWithCatalog(magazinCatalog);
      callback(magazinCatalog);
    })
    .catch(err => {
      console.error('Could not load shop catalog for cart', err);
      magazinCatalog = magazinCatalog || {};
      callback(magazinCatalog);
    });
}

// Prunes any cart entries whose id no longer exists in the live
// catalog (e.g. an item was removed/renamed from the app after it
// was added to someone's cart) - without this, readCartCount() (which
// is deliberately catalog-independent, so the badge can show a number
// before the catalog has even loaded) can disagree with the drawer,
// which only ever lists ids the catalog still recognizes. Runs every
// time the catalog resolves, so the badge self-heals as soon as the
// cart is opened or otherwise touched anywhere on the site.
function reconcileCartWithCatalog(CATALOG) {
  let changed = false;
  Object.keys(cart).forEach(id => {
    const product = CATALOG[id];
    // Also drops anything that WAS available when it got added but has
    // since been marked out of stock/preorder from the app - the
    // server would reject it at checkout anyway (handleShopCheckout /
    // handleShopCodCheckout in worker.js both re-check this
    // independently), so there's no reason to let a shopper walk all
    // the way to checkout with something they can no longer actually
    // buy still sitting in their cart.
    if (!product || (product.availability && product.availability !== 'available')) {
      delete cart[id];
      changed = true;
    }
  });
  if (changed) saveCart();
}

function cartIdsFromCatalog(CATALOG) {
  return Object.keys(cart).filter(id => cart[id] > 0 && CATALOG[id]);
}

// Empties the cart entirely, regardless of catalog state - doesn't
// need CATALOG since it just wipes everything.
function clearCart() {
  cart = {};
  saveCart();
  renderCartDrawer();
}

function renderCartDrawer() {
  const listEl = document.getElementById('cartItemsList');
  const totalEl = document.getElementById('cartTotal');
  const checkoutBtn = document.getElementById('cartCheckoutBtn');
  const clearBtn = document.getElementById('cartClearBtn');
  // None of the drawer's own elements exist on this page yet (footer
  // hasn't loaded) or ever will (very early in page load) - nothing to do.
  if (!listEl && !totalEl && !checkoutBtn) return;

  ensureCatalog((CATALOG) => {
    const ids = cartIdsFromCatalog(CATALOG);

    if (listEl) {
      if (ids.length === 0) {
        listEl.innerHTML = '<p class="cart-empty">Кошницата е празна.</p>';
      } else {
        listEl.innerHTML = '';
        ids.forEach(id => {
          const product = CATALOG[id];
          const qty = cart[id];
          const row = document.createElement('div');
          row.className = 'cart-item-row';
          row.innerHTML =
            '<div class="cart-item-info">' +
              '<span class="cart-item-name">' + product.name + '</span>' +
              '<span class="cart-item-price">' + formatEur(product.price) + '</span>' +
            '</div>' +
            '<div class="cart-item-qty">' +
              '<button type="button" class="cart-qty-btn" data-action="dec" data-id="' + id + '" aria-label="Намали">&minus;</button>' +
              '<span class="cart-qty-value">' + qty + '</span>' +
              '<button type="button" class="cart-qty-btn" data-action="inc" data-id="' + id + '" aria-label="Увеличи">+</button>' +
              '<button type="button" class="cart-remove-btn" data-action="remove" data-id="' + id + '">Премахни</button>' +
            '</div>';
          listEl.appendChild(row);
        });
      }
    }

    if (totalEl) {
      const total = ids.reduce((sum, id) => sum + CATALOG[id].price * cart[id], 0);
      totalEl.textContent = formatEur(total);
    }

    if (checkoutBtn) checkoutBtn.disabled = ids.length === 0;
    if (clearBtn) clearBtn.disabled = ids.length === 0;
  });
}

function addToCart(id) {
  ensureCatalog((CATALOG) => {
    const product = CATALOG[id];
    if (!product) return;
    // Belt-and-suspenders: the rendered button is already disabled for
    // an out-of-stock/preorder item (see Render-MagazinItemHtml /
    // Render-MagazinProductPage in release_publisher.ps1), so a normal
    // click never reaches here, but this guards any other path into
    // addToCart too. The real enforcement is server-side regardless
    // (handleShopCheckout / handleShopCodCheckout in worker.js).
    if (product.availability && product.availability !== 'available') return;
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    renderCartDrawer();
    openCartDrawer();
  });
}

function openCartDrawer() {
  const overlay = document.getElementById('cartOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  renderCartDrawer();
}

function closeCartDrawer() {
  const overlay = document.getElementById('cartOverlay');
  if (overlay) overlay.style.display = 'none';
}

// Delegated so it works regardless of which page's DOM currently has
// the drawer/grid in it, and regardless of load order between the
// static page content (e.g. /magazin's own product grid) and the
// async header/footer fragments.
document.addEventListener('click', (e) => {
  // Product page gallery (magazin/<id>/) - swaps the large image and
  // marks which thumbnail is active. Only present on a page with more
  // than one photo for that item; harmless no-op everywhere else.
  const thumb = e.target.closest('.magazin-product-thumb');
  if (thumb) {
    const full = thumb.getAttribute('data-full');
    const mainImg = document.getElementById('productMainImage');
    if (mainImg && full) mainImg.src = full;
    document.querySelectorAll('.magazin-product-thumb').forEach(t => t.classList.remove('is-active'));
    thumb.classList.add('is-active');
    return;
  }

  const addBtn = e.target.closest('.magazin-add-to-cart');
  if (addBtn) {
    e.preventDefault();
    addToCart(addBtn.getAttribute('data-item-id'));
    return;
  }

  const qtyBtn = e.target.closest('.cart-qty-btn, .cart-remove-btn');
  if (qtyBtn) {
    const id = qtyBtn.getAttribute('data-id');
    const action = qtyBtn.getAttribute('data-action');
    if (action === 'inc') cart[id] = (cart[id] || 0) + 1;
    if (action === 'dec') cart[id] = Math.max(0, (cart[id] || 0) - 1);
    if (action === 'remove') cart[id] = 0;
    if (!cart[id]) delete cart[id];
    saveCart();
    renderCartDrawer();
    return;
  }

  // /magazin's own heading button - the nav's cart icon is handled
  // separately below, since it also needs the same-tab-vs-navigate
  // distinction setupPageTransitionLinks otherwise makes for it.
  if (e.target.closest('#cartToggleBtn')) {
    e.preventDefault();
    openCartDrawer();
    return;
  }

  if (e.target.closest('#cartClearBtn')) {
    e.preventDefault();
    clearCart();
    return;
  }

  if (e.target.id === 'cartCloseBtn' || e.target.id === 'cartOverlay') {
    closeCartDrawer();
    return;
  }
});

// The drawer itself no longer collects contact/shipping/payment info or
// talks to the server at all - it's just a summary now. The checkout
// button's only job is to send the shopper to the dedicated /checkout/
// page (see checkout/index.html + setupCheckoutPage below), which is
// where CHECKOUT_URL (Stripe Elements/PaymentIntent flow) and
// COD_CHECKOUT_URL actually get used.
function setupCartCheckout() {
  const checkoutBtn = document.getElementById('cartCheckoutBtn');
  if (!checkoutBtn) return;
  checkoutBtn.addEventListener('click', () => {
    ensureCatalog((CATALOG) => {
      const ids = cartIdsFromCatalog(CATALOG);
      if (ids.length === 0) return;
      window.location.href = '/checkout/';
    });
  });
}

// Success/cancel banner after redirect back from Stripe - #checkoutBanner
// only exists on /magazin, so this is a silent no-op everywhere else.
// The cart is only cleared on genuine success, and the query param is
// stripped afterward so a page refresh doesn't re-show it.
function setupCheckoutBanner() {
  const bannerEl = document.getElementById('checkoutBanner');
  if (!bannerEl) return;

  const params = new URLSearchParams(window.location.search);
  const checkoutState = params.get('checkout');
  if (checkoutState !== 'success' && checkoutState !== 'canceled') return;

  if (checkoutState === 'success') {
    bannerEl.textContent = 'Благодарим за поръчката! Провери имейла си за потвърждение (и връзка за изтегляне, ако си купил/а дигитален продукт).';
    bannerEl.className = 'checkout-banner checkout-banner-success';
    cart = {};
    saveCart();
    renderCartDrawer();
  } else {
    bannerEl.textContent = 'Плащането беше отменено - количката ти е запазена.';
    bannerEl.className = 'checkout-banner checkout-banner-canceled';
  }
  bannerEl.style.display = 'block';

  params.delete('checkout');
  const newQuery = params.toString();
  const newUrl = window.location.pathname + (newQuery ? '?' + newQuery : '') + window.location.hash;
  window.history.replaceState({}, '', newUrl);
}

// ── Checkout page (/checkout/) ──────────────────────────────────
// Replaces the old cart-drawer checkout entirely - card payments now
// go through Stripe's Payment Element (Stripe Elements), mounted
// directly on this page via Stripe.js, instead of a redirect to a
// stripe.com-hosted Checkout page. See handleShopCreatePaymentIntent
// / handlePaymentIntentSucceeded in worker.js for the server side of
// the card path, and handleShopCodCheckout (unchanged) for cash-on-
// delivery, which this page also now collects instead of the drawer.
//
// Stripe.js is loaded lazily, only on this page and only once the
// shopper actually picks the card path and clicks "Продължи" - no
// reason to pull in a third-party script on every page load for a
// feature most visitors never reach.
let stripeJsPromise = null;
function loadStripeJs() {
  if (window.Stripe) return Promise.resolve();
  if (stripeJsPromise) return stripeJsPromise;
  stripeJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Stripe.js could not be loaded'));
    document.head.appendChild(script);
  });
  return stripeJsPromise;
}

// Appearance API theme - matches the Payment Element's rendered
// iframe fields to the site's own dark panel/input language (same
// colors/radius as .cart-cod-input in style.css) rather than Stripe's
// default light theme.
const CHECKOUT_STRIPE_APPEARANCE = {
  theme: 'night',
  variables: {
    colorPrimary: '#f2f2f2',
    colorBackground: '#111111',
    colorText: '#f2f2f2',
    colorTextSecondary: '#bfbfbf',
    colorTextPlaceholder: '#555555',
    colorDanger: '#e05a4e',
    fontFamily: 'Rubik, sans-serif',
    fontSizeBase: '14px',
    borderRadius: '12px',
    spacingUnit: '4px'
  },
  rules: {
    '.Input': {
      border: '1px solid rgba(255, 255, 255, 0.08)',
      boxShadow: 'none',
      padding: '12px 14px'
    },
    '.Input:focus': {
      border: '1px solid rgba(255, 255, 255, 0.3)',
      boxShadow: 'none'
    },
    '.Label': {
      color: '#bfbfbf'
    },
    '.Tab': {
      border: '1px solid rgba(255, 255, 255, 0.08)',
      background: '#111111'
    },
    '.Tab--selected': {
      border: '1px solid rgba(255, 255, 255, 0.3)'
    }
  }
};

function setupCheckoutPage() {
  const form = document.getElementById('checkoutForm');
  if (!form) return; // not on /checkout/ - nothing to do

  // The whole flow is handled by hand below (validation, then either a
  // COD POST or a PaymentIntent creation + Payment Element confirm) -
  // a native form submit (e.g. Enter key in a text field) would just
  // reload the page for nothing, so it's suppressed outright.
  form.addEventListener('submit', (e) => e.preventDefault());

  const itemsListEl = document.getElementById('checkoutItemsList');
  const subtotalEl = document.getElementById('checkoutSubtotalAmount');
  const deliveryRow = document.getElementById('checkoutDeliveryFeeRow');
  const deliveryLabelEl = document.getElementById('checkoutDeliveryFeeLabel');
  const deliveryFeeEl = document.getElementById('checkoutDeliveryFeeAmount');
  const totalEl = document.getElementById('checkoutTotalAmount');
  const shippingSection = document.getElementById('checkoutShippingSection');
  const addressFields = document.getElementById('checkoutAddressFields');
  const officeField = document.getElementById('checkoutOfficeText');
  const codOption = document.getElementById('checkoutPayCodOption');
  const codRadio = document.getElementById('checkoutPayCod');
  const cardRadio = document.getElementById('checkoutPayCard');
  const continueBtn = document.getElementById('checkoutContinueBtn');
  const statusEl = document.getElementById('checkoutStatus');
  const paymentStep = document.getElementById('checkoutPaymentStep');
  const payBtn = document.getElementById('checkoutPayBtn');

  let currentIds = [];
  let currentCatalog = null;
  let hasPhysical = false;
  let stripeInstance = null;
  let stripeElements = null;
  let checkoutPaymentIntentId = null;

  const showStatus = (msg, isError) => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '' : 'var(--muted)';
    statusEl.style.display = msg ? 'block' : 'none';
  };

  const val = (elId) => {
    const el = document.getElementById(elId);
    return el ? el.value.trim() : '';
  };

  function currentDeliveryMethod() {
    const officeRadio = document.getElementById('checkoutDeliveryOffice');
    return (officeRadio && officeRadio.checked) ? 'office' : 'address';
  }

  function currentSubtotal() {
    if (!currentCatalog) return 0;
    return currentIds.reduce((sum, id) => sum + currentCatalog[id].price * cart[id], 0);
  }

  function updateDeliveryFeePreview() {
    if (!hasPhysical || !currentCatalog || currentIds.length === 0) {
      if (deliveryRow) deliveryRow.style.display = 'none';
      if (totalEl) totalEl.textContent = formatEur(currentSubtotal());
      return;
    }
    const method = currentDeliveryMethod();
    const weightKg = calcCartWeightKg(currentCatalog, currentIds);
    const feeEur = calcSpeedyDeliveryFeeEur(weightKg, method);
    if (deliveryRow) deliveryRow.style.display = 'flex';
    if (deliveryLabelEl) deliveryLabelEl.textContent = 'Доставка (Speedy, ' + (method === 'office' ? 'до офис' : 'до адрес') + ')';
    if (deliveryFeeEl) deliveryFeeEl.textContent = formatEur(feeEur);
    if (totalEl) totalEl.textContent = formatEur(currentSubtotal() + feeEur);
  }

  function refreshSummary() {
    ensureCatalog((CATALOG) => {
      currentCatalog = CATALOG;
      currentIds = cartIdsFromCatalog(CATALOG);

      // Nothing to check out - send the shopper back to the shop
      // rather than showing an empty checkout page.
      if (currentIds.length === 0) {
        window.location.href = MAGAZIN_URL;
        return;
      }

      if (itemsListEl) {
        itemsListEl.innerHTML = '';
        currentIds.forEach((id) => {
          const product = CATALOG[id];
          const qty = cart[id];
          const row = document.createElement('div');
          row.className = 'checkout-item-row';
          row.innerHTML =
            '<span class="checkout-item-name">' + product.name +
              (qty > 1 ? ' <span class="checkout-item-qty">&times; ' + qty + '</span>' : '') +
            '</span>' +
            '<span class="checkout-item-price">' + formatEur(product.price * qty) + '</span>';
          itemsListEl.appendChild(row);
        });
      }

      if (subtotalEl) subtotalEl.textContent = formatEur(currentSubtotal());

      hasPhysical = currentIds.some((id) => !CATALOG[id].digital);
      const allPhysical = currentIds.length > 0 && currentIds.every((id) => !CATALOG[id].digital);

      if (shippingSection) shippingSection.style.display = hasPhysical ? 'block' : 'none';

      if (codRadio) codRadio.disabled = !allPhysical;
      if (codOption) codOption.classList.toggle('is-disabled', !allPhysical);
      if (!allPhysical && codRadio) {
        codRadio.checked = false;
        if (cardRadio) cardRadio.checked = true;
      }

      updateDeliveryFeePreview();
    });
  }

  // Delivery method radios (address vs. office pickup) - swaps which
  // fields are shown and refreshes the fee preview, same pattern the
  // old cart drawer used.
  document.addEventListener('change', (e) => {
    if (e.target && e.target.name === 'checkoutDeliveryMethod') {
      const isOffice = e.target.value === 'office';
      if (addressFields) addressFields.style.display = isOffice ? 'none' : 'flex';
      if (officeField) officeField.style.display = isOffice ? 'block' : 'none';
      updateDeliveryFeePreview();
    }
  });

  function buildCheckoutPayload() {
    return {
      items: currentIds.map((id) => ({ id: id, qty: cart[id] })),
      customer: { name: val('checkoutName'), email: val('checkoutEmail'), phone: val('checkoutPhone') },
      shipping: { line1: val('checkoutLine1'), line2: val('checkoutLine2'), city: val('checkoutCity'), postalCode: val('checkoutPostal') },
      delivery: { method: currentDeliveryMethod(), officeText: val('checkoutOfficeText') }
    };
  }

  function validateForm() {
    if (!val('checkoutName')) return 'Моля, въведи име.';
    if (!val('checkoutEmail')) return 'Моля, въведи имейл.';

    if (hasPhysical) {
      if (!val('checkoutPhone')) return 'Моля, въведи телефон - куриерът има нужда от него.';
      if (!val('checkoutCity')) return 'Моля, въведи град.';
      if (currentDeliveryMethod() === 'address') {
        if (!val('checkoutLine1') || !val('checkoutPostal')) return 'Моля, попълни адреса и пощенския код за доставка до адрес.';
      } else if (!val('checkoutOfficeText')) {
        return 'Моля, посочи кой офис на Speedy предпочиташ.';
      }
    }
    return null;
  }

  function resetContinueBtn() {
    continueBtn.disabled = false;
    continueBtn.textContent = 'Продължи';
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      const err = validateForm();
      if (err) { showStatus(err, true); return; }
      showStatus('', false);

      const isCod = !!(codRadio && codRadio.checked && !codRadio.disabled);
      const payload = buildCheckoutPayload();

      continueBtn.disabled = true;
      continueBtn.textContent = 'Един момент...';

      if (isCod) {
        fetch(COD_CHECKOUT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then((res) => res.json().then((data) => ({ ok: res.ok, data: data })))
          .then((result) => {
            if (result.ok && result.data && result.data.url) {
              window.location.href = result.data.url;
            } else {
              throw new Error((result.data && result.data.error) || 'Поръчката не можа да бъде направена.');
            }
          })
          .catch((e) => {
            showStatus('Грешка: ' + e.message, true);
            resetContinueBtn();
          });
        return;
      }

      // Card path - create the PaymentIntent server-side, then load
      // Stripe.js (if not already) and mount the Payment Element
      // against its client secret.
      fetch(CREATE_PAYMENT_INTENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then((res) => res.json().then((data) => ({ ok: res.ok, data: data })))
        .then((result) => {
          if (!result.ok || !result.data || !result.data.clientSecret) {
            throw new Error((result.data && result.data.error) || 'Плащането не можа да бъде стартирано.');
          }
          const clientSecret = result.data.clientSecret;
          // A PaymentIntent's client secret is always "pi_XXX_secret_YYY" -
          // the "pi_XXX" part is its id, which is exactly what
          // handleShopThankYou's pi_ branch expects as ?session_id=.
          checkoutPaymentIntentId = clientSecret.split('_secret_')[0];

          if (totalEl && typeof result.data.amountTotal === 'number') {
            totalEl.textContent = formatEur(result.data.amountTotal / 100);
          }

          return loadStripeJs().then(() => {
            stripeInstance = stripeInstance || Stripe(STRIPE_PUBLISHABLE_KEY);
            stripeElements = stripeInstance.elements({
              clientSecret: clientSecret,
              appearance: CHECKOUT_STRIPE_APPEARANCE
            });
            stripeElements.create('payment').mount('#checkoutPaymentElement');

            // Lock the form once the PaymentIntent (and its amount) is
            // fixed - editing anything now wouldn't change what's about
            // to be charged, only what worker.js's webhook later reads
            // back off the PaymentIntent's own metadata.
            form.querySelectorAll('input').forEach((el) => { el.disabled = true; });
            continueBtn.style.display = 'none';
            if (paymentStep) paymentStep.style.display = 'block';
            showStatus('', false);
          });
        })
        .catch((e) => {
          showStatus('Грешка: ' + e.message, true);
          resetContinueBtn();
        });
    });
  }

  if (payBtn) {
    payBtn.addEventListener('click', () => {
      if (!stripeInstance || !stripeElements || !checkoutPaymentIntentId) return;
      payBtn.disabled = true;
      payBtn.textContent = 'Един момент...';
      showStatus('', false);

      stripeInstance.confirmPayment({
        elements: stripeElements,
        confirmParams: {
          return_url: window.location.origin + '/shop/thank-you?session_id=' + encodeURIComponent(checkoutPaymentIntentId)
        },
        // Most cards never need to leave this page at all (no redirect);
        // a 3D Secure challenge shows as an in-page modal in most cases.
        // The rare case that genuinely needs a full-page redirect (e.g.
        // certain bank-redirect payment methods) still lands correctly
        // on /shop/thank-you via return_url above.
        redirect: 'if_required'
      }).then((result) => {
        if (result.error) {
          showStatus(result.error.message || 'Плащането не бе успешно.', true);
          payBtn.disabled = false;
          payBtn.textContent = 'Плати';
          return;
        }
        window.location.href = '/shop/thank-you?session_id=' + encodeURIComponent(checkoutPaymentIntentId);
      }).catch((e) => {
        showStatus('Грешка: ' + e.message, true);
        payBtn.disabled = false;
        payBtn.textContent = 'Плати';
      });
    });
  }

  refreshSummary();
}

// Relocates the drawer to a direct child of <body>, same as and for
// the same reason as the newsletter modal below: escapes any
// transformed ancestor (Lenis included) that would otherwise trap
// this position:fixed overlay off-screen instead of covering the
// real viewport.
function setupCartDrawer() {
  const overlay = document.getElementById('cartOverlay');
  if (!overlay) return;
  document.body.appendChild(overlay);
  setupCartCheckout();
  updateCartBadges();
}

// The nav's cart icon opens the drawer in place on WHATEVER page
// you're currently on - never a navigation, even though its href
// still points at /magazin as a plain-link fallback (no-JS, or a
// deliberate ctrl/cmd/middle-click to open the shop page itself in a
// new tab). stopPropagation keeps this same click from also reaching
// setupPageTransitionLinks' document-level listener below, which
// would otherwise still navigate away 550ms later even after
// preventDefault() here already stopped the browser's own default
// link behavior - preventDefault alone doesn't stop other listeners.
function setupNavCartLink() {
  const link = document.querySelector('.nav a.nav-cart');
  if (!link) return;
  link.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    openCartDrawer();
  });
}

// Nav + active section logic
let navLinks = [];
let sections = [];

function computeNavAndSections() {
  navLinks = [...document.querySelectorAll('.nav a')];

  sections = navLinks
    .map(link => {
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('#')) return null;
      return document.querySelector(href);
    })
    .filter(Boolean);

  // Wire click behavior for in-page anchors
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return; // external page; let browser handle

      navLinks.forEach(item => item.classList.remove('is-active'));
      link.classList.add('is-active');
    });
  });
}

// Mobile nav: floating toggle button opens/closes a centered overlay
// menu with a dimmed backdrop. No-op on desktop since the toggle
// button and backdrop stay hidden via CSS above the mobile breakpoint.
// Newsletter signup form (in the footer, present on every page) -
// mirrors the contact form's own hidden-iframe + postMessage pattern
// in contacts.html, generalized here since this one is site-wide
// rather than page-specific.
function setupNewsletterModal() {
  const overlay = document.getElementById('newsletterModalOverlay');
  const closeBtn = document.getElementById('newsletterModalCloseBtn');
  if (!overlay || !closeBtn) return;

  // Moves the overlay to be a direct child of <body>, escaping the
  // data-include wrapper it's currently nested in - if that wrapper or
  // any ancestor has a CSS transform applied (from Lenis or otherwise),
  // it creates a new containing block for position:fixed descendants,
  // trapping the overlay relative to that ancestor's box instead of the
  // true viewport. This is what caused the backdrop to show (the overlay
  // itself still rendered) while the centered modal card landed off-screen.
  document.body.appendChild(overlay);

  function openModal() {
    overlay.style.display = 'flex';
  }
  function closeModal() {
    overlay.style.display = 'none';
  }

  // Both footer variants (desktop/mobile) have their own trigger button -
  // only one is ever visible at a time via CSS, but both share this class.
  document.querySelectorAll('.newsletter-trigger-btn').forEach((btn) => {
    btn.addEventListener('click', openModal);
  });

  closeBtn.addEventListener('click', closeModal);

  // Clicking the dark backdrop (not the modal card itself) closes it too.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display === 'flex') closeModal();
  });
}

function setupNewsletterForm(config) {
  const form = document.getElementById(config.formId);
  if (!form) return;

  const startTimeField = document.getElementById(config.startTimeId);
  const submitBtn = document.getElementById(config.submitBtnId);
  const status = document.getElementById(config.statusId);
  const iframe = document.getElementById(config.iframeId);
  const originalBtnText = submitBtn.textContent;
  let resetTimer = null;

  startTimeField.value = Date.now();

  function resetButton() {
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
    submitBtn.style.cursor = 'pointer';
    submitBtn.textContent = originalBtnText;
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  }

  form.addEventListener('submit', () => {
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.6';
    submitBtn.style.cursor = 'default';
    submitBtn.textContent = '...';
    status.style.display = 'none';

    // Safety net: force a reset after 12 seconds no matter what, in
    // case the Worker's response never arrives at all.
    resetTimer = setTimeout(() => {
      resetButton();
      status.textContent = 'Нещо се обърка - опитай отново.';
      status.style.color = '#e05a4e';
      status.style.display = 'block';
    }, 12000);
  });

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'newsletterSubscribeResult') return;
    // Only react if this message actually came from THIS form's own
    // hidden iframe - with two independent newsletter forms possibly
    // present on the same page (footer modal + homepage section),
    // submitting one shouldn't reset/show status on the other.
    if (event.source !== iframe.contentWindow) return;

    resetButton();

    if (event.data.success) {
      form.reset();
      startTimeField.value = Date.now();
      status.textContent = 'Провери имейла си, за да потвърдиш абонамента!';
      status.style.color = '';
      status.style.display = 'block';
    } else {
      status.textContent = 'Нещо се обърка: ' + (event.data.error || 'моля опитай отново');
      status.style.color = '#e05a4e';
      status.style.display = 'block';
    }
  });
}

function setupMobileNav() {
  const toggle = document.querySelector('.mobile-nav-toggle');
  const navWrap = document.querySelector('.nav-wrap');
  const backdrop = document.querySelector('.mobile-nav-backdrop');
  if (!toggle || !navWrap || !backdrop) return;

  // nav-wrap and the backdrop need relocating on mobile - on desktop,
  // .nav-wrap already works correctly in its original position (a
  // sticky top bar within the header), and moving it out to body
  // would place it after the footer in DOM order, breaking that
  // entirely. The relocation only exists to keep these pieces outside
  // .page's blur filter, since the menu overlay itself should stay
  // sharp while open - not needed on desktop at all.
  const isMobile = window.matchMedia('(max-width: 919.98px)').matches;
  if (isMobile) {
    document.body.appendChild(navWrap);
    document.body.appendChild(backdrop);
  }

  // The toggle button normally stays inside the header, blurring
  // naturally along with everything else when a card modal opens.
  // But while the *menu itself* is open, it needs to stay outside
  // .page's blur so it remains visible and clickable to close the
  // menu - so it's temporarily relocated to body only for that
  // duration, then moved back to its original spot in the header
  // once the menu closes.
  const toggleHomeParent = toggle.parentElement;

  function closeMenu() {
    navWrap.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    document.body.classList.remove('nav-open');
    if (isMobile && toggleHomeParent) toggleHomeParent.appendChild(toggle);
  }

  function openMenu() {
    navWrap.classList.add('is-open');
    backdrop.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('nav-open');
    if (isMobile) document.body.appendChild(toggle);
  }

  toggle.addEventListener('click', () => {
    if (navWrap.classList.contains('is-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  backdrop.addEventListener('click', closeMenu);

  // Deliberately NOT closing on nav link clicks: every nav link now
  // triggers the page transition overlay, which sits at a much higher
  // z-index and will fully cover this menu once it fades in, then the
  // whole page navigates away anyway. Closing this menu independently
  // on click created a visible gap - its own fade-out finishing before
  // the transition overlay had fully faded in, briefly showing the
  // real page underneath.
}

const setActiveLink = () => {
  if (!sections.length) return;

  const offset = window.innerHeight * 0.25;
  let currentId = '';

  sections.forEach(section => {
    const rect = section.getBoundingClientRect();
    if (rect.top <= offset && rect.bottom >= offset) {
      currentId = `#${section.id}`;
    }
  });

  navLinks.forEach(link => {
    link.classList.toggle('is-active', link.getAttribute('href') === currentId);
  });
};

// Prevent right-click "Save Image As..." on any image - uses event
// delegation on document so it also covers images added dynamically
// later (e.g. cover art populated into the artist/smart-link modals
// after a click), not just images present at initial page load.
// Note: this is a deterrent only, same as the CSS drag-prevention -
// it doesn't provide real protection against someone determined to
// extract an image via browser dev tools.
document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'IMG') {
    e.preventDefault();
  }
});

// The CSS -webkit-user-drag property only covers Chrome/Safari/Edge -
// Firefox never implemented it at all. The standard, cross-browser way
// to block image dragging is the HTML draggable attribute itself.
// dragstart is used (rather than setting draggable="false" once at
// load) so it also covers images added dynamically later, same as the
// contextmenu listener above.
document.addEventListener('dragstart', (e) => {
  if (e.target.tagName === 'IMG') {
    e.preventDefault();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  // Single source of truth for both the homepage's "latest releases"
  // row and its featured-release carousel: fetches music.html's own
  // grid once and shares the result between both, so adding a
  // release only ever means editing music.html.
  async function fetchMusicPageCards() {
    const res = await fetch('./music/');
    if (!res.ok) throw new Error('Failed to load music page: ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const cards = doc.querySelectorAll('.music-grid .music-card');
    if (!cards.length) throw new Error('No releases found on music page');
    return cards;
  }

  function syncHomeLatestReleases(sourceCards) {
    const scroller = document.querySelector('.home-latest-scroller');
    if (!scroller) return; // only relevant on the homepage

    function buildCard(card, hidden) {
      const href = card.getAttribute('href') || '';
      const label = card.getAttribute('aria-label') || '';
      // Read directly from the inline style attribute - resolves
      // correctly here too since --track-image's url() is resolved
      // relative to the shared stylesheet, not the HTML page, so
      // the raw path string can be reused verbatim.
      const trackImage = card.style.getPropertyValue('--track-image');
      const titleEl = card.querySelector('.music-title');
      const titleText = titleEl ? titleEl.textContent : label;

      const a = document.createElement('a');
      a.className = 'music-card';
      a.href = href;
      a.rel = 'noopener noreferrer';
      if (hidden) {
        a.setAttribute('aria-hidden', 'true');
        a.tabIndex = -1;
      } else {
        a.setAttribute('aria-label', label);
      }
      a.style.setProperty('--track-image', trackImage);

      const span = document.createElement('span');
      span.className = 'music-title';
      span.textContent = titleText;
      a.appendChild(span);
      return a;
    }

    const fragment = document.createDocumentFragment();
    sourceCards.forEach((card) => fragment.appendChild(buildCard(card, false)));
    // Duplicate set, hidden from assistive tech/keyboard nav - exists
    // only so the scroll animation can loop seamlessly.
    sourceCards.forEach((card) => fragment.appendChild(buildCard(card, true)));

    scroller.replaceChildren(fragment);
  }

  // Mirrors artists.html's own applyPhotoFraming exactly (same
  // cover-scale + zoom + background-position math) - reused here so
  // feature-slide images support the same manual zoom/position
  // adjustment as artist photos, set via the app's "Adjust Photo"
  // button per slide. A slide with no custom framing data attributes
  // just keeps the plain CSS cover/center default untouched.
  function applyFeatureSlideFraming(slide) {
    const style = slide.getAttribute('style') || '';
    const imgMatch = style.match(/--feature-image:\s*url\('([^']*)'\)/);
    const coverUrl = imgMatch ? imgMatch[1] : '';
    if (!coverUrl) return;

    // The crop control is desktop-only - mobile always stays at the
    // plain default (cover/center), regardless of what's set for
    // desktop, by design preference.
    const isDesktop = window.matchMedia('(min-width: 920px)').matches;
    if (!isDesktop) {
      slide.style.backgroundSize = '';
      slide.style.backgroundPosition = '';
      return;
    }

    const zoomPercent = parseFloat(slide.getAttribute('data-photo-zoom')) || 100;
    let xPercent = parseFloat(slide.getAttribute('data-photo-x'));
    let yPercent = parseFloat(slide.getAttribute('data-photo-y'));
    if (isNaN(xPercent)) xPercent = 50;
    if (isNaN(yPercent)) yPercent = 50;

    // No custom framing on this slide at all - leave the plain CSS
    // background-size:cover; background-position:center default alone.
    if (zoomPercent === 100 && xPercent === 50 && yPercent === 50) {
      slide.style.backgroundSize = '';
      slide.style.backgroundPosition = '';
      return;
    }

    const loader = new Image();
    loader.onload = function () {
      const contW = slide.offsetWidth;
      const contH = slide.offsetHeight;
      const imgW = loader.naturalWidth;
      const imgH = loader.naturalHeight;
      if (!imgW || !imgH || !contW || !contH) return;

      const coverScale = Math.max(contW / imgW, contH / imgH);
      const totalScale = coverScale * (zoomPercent / 100);
      const sizeWidthPercent = (imgW * totalScale / contW) * 100;
      const sizeHeightPercent = (imgH * totalScale / contH) * 100;

      slide.style.backgroundSize = sizeWidthPercent + '% ' + sizeHeightPercent + '%';
      slide.style.backgroundPosition = xPercent + '% ' + yPercent + '%';
    };
    loader.src = coverUrl;
  }

  function initFeatureSlideFraming() {
    const slides = Array.from(document.querySelectorAll('.feature-slide'));
    if (!slides.length) return;
    slides.forEach(applyFeatureSlideFraming);

    // Re-applies on resize since this carousel is always visible
    // (unlike the artist modal, which only opens briefly) - a resize
    // across the 920px breakpoint switches between desktop/mobile
    // framing values, and even a same-side resize can shift the
    // cover-scale math enough to matter.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => slides.forEach(applyFeatureSlideFraming), 150);
    }, { passive: true });
  }
  initFeatureSlideFraming();

  function initFeatureCarousel() {
    const slides = Array.from(document.querySelectorAll('.feature-slide'));
    if (slides.length <= 1) return; // nothing to navigate to - arrows stay hidden

    let current = slides.findIndex((s) => s.classList.contains('is-active'));
    if (current === -1) current = 0;

    // Every slide besides the starting active one begins parked
    // off-screen to the right, ready to slide in from that side the
    // first time it's navigated to.
    slides.forEach((s, i) => {
      if (i !== current) s.style.transform = 'translateX(100%)';
    });

    let isAnimating = false;

    function goTo(targetIndex, direction) {
      if (isAnimating) return; // ignore rapid double-clicks mid-transition
      const newIndex = (targetIndex + slides.length) % slides.length;
      if (newIndex === current) return;

      const outgoing = slides[current];
      const incoming = slides[newIndex];
      isAnimating = true;

      // Snap the incoming slide to its correct starting side instantly
      // (no transition), then force a reflow so the browser registers
      // that position before the transition is re-enabled - otherwise
      // it would animate from wherever it was last parked instead.
      incoming.style.transition = 'none';
      incoming.style.transform = direction > 0 ? 'translateX(100%)' : 'translateX(-100%)';
      incoming.classList.add('is-active');
      void incoming.offsetWidth;
      incoming.style.transition = '';

      requestAnimationFrame(() => {
        outgoing.style.transform = direction > 0 ? 'translateX(-100%)' : 'translateX(100%)';
        incoming.style.transform = 'translateX(0%)';
      });

      function onTransitionEnd(e) {
        if (e.target !== incoming || e.propertyName !== 'transform') return;
        incoming.removeEventListener('transitionend', onTransitionEnd);
        outgoing.classList.remove('is-active');
        // Reset the now off-screen outgoing slide to a neutral parked
        // position, silently (no transition), so it's ready to be an
        // incoming slide again later regardless of which direction
        // it's approached from next time.
        outgoing.style.transition = 'none';
        outgoing.style.transform = 'translateX(100%)';
        void outgoing.offsetWidth;
        outgoing.style.transition = '';
        current = newIndex;
        isAnimating = false;
      }
      incoming.addEventListener('transitionend', onTransitionEnd);
    }

    const prevBtn = document.querySelector('.feature-arrow-prev');
    const nextBtn = document.querySelector('.feature-arrow-next');
    prevBtn.addEventListener('click', () => goTo(current - 1, -1));
    nextBtn.addEventListener('click', () => goTo(current + 1, 1));
    prevBtn.hidden = false;
    nextBtn.hidden = false;
  }
  initFeatureCarousel();

  (async () => {
    try {
      const sourceCards = await fetchMusicPageCards();
      syncHomeLatestReleases(sourceCards);
    } catch (err) {
      // Leave the scroller's existing hardcoded fallback cards in
      // place rather than clearing anything.
      console.warn('Could not sync latest releases from music page, showing fallback:', err);
    }
  })();

  // 2. Load header/footer partials
  await includeHtmlFragments();
  // Signals that .hero-logo-link etc. now actually exist in the DOM -
  // logo3d.js waits for this before querying for them, since it runs
  // independently and would otherwise race against this async fetch.
  document.dispatchEvent(new CustomEvent('header-ready'));

  // 3. Now the .nav exists, so compute nav and sections
  computeNavAndSections();
  setupMobileNav();
  setActiveLink();
  setupCartDrawer();
  setupNavCartLink();
  setupCheckoutBanner();
  setupCheckoutPage();
  setupNewsletterModal();
  setupNewsletterForm({
    formId: 'newsletterForm',
    startTimeId: 'newsletterStartTime',
    submitBtnId: 'newsletterSubmitBtn',
    statusId: 'newsletterStatus',
    iframeId: 'newsletter_hidden_iframe'
  });
  setupNewsletterForm({
    formId: 'homeNewsletterForm',
    startTimeId: 'homeNewsletterStartTime',
    submitBtnId: 'homeNewsletterSubmitBtn',
    statusId: 'homeNewsletterStatus',
    iframeId: 'home_newsletter_hidden_iframe'
  });

  // Toggles the "floating popup" header state once scrolled past the
  // very top - see .nav-wrap / body.scrolled in style.css.
  function updateScrolledState() {
    document.body.classList.toggle('scrolled', window.scrollY > 20);
  }
  updateScrolledState();

  window.addEventListener('scroll', setActiveLink, { passive: true });
  window.addEventListener('scroll', updateScrolledState, { passive: true });
  window.addEventListener('resize', setActiveLink);
  window.addEventListener('load', setActiveLink);

  const currentYear = new Date().getFullYear();
  document.querySelectorAll(".year").forEach(el => {
    el.textContent = currentYear + " © INTER(MISSION)";
  });

  setupPageTransitionLinks();
});

// ── Page transitions ───────────────────────────────────────────
// Full-screen black overlay with the logo, present in every page's
// static HTML (not injected here) so it covers the page with zero
// flash on load. The header logo and every main nav link (including
// Discord) trigger a transition - smart link cards, music cards,
// artist tiles, and contact links are deliberately left alone.
const pageTransitionOverlay = document.getElementById('pageTransitionOverlay');

// Locks the page's own vertical scrollbar for as long as the overlay
// is covering the screen (including its fade transition) - without
// this, navigating between pages of very different heights (e.g. the
// tall homepage) can make the scrollbar appear/disappear WHILE the
// overlay is visible, shifting its centered logo sideways by the
// scrollbar's own width.
function lockScrollForTransition() {
  document.documentElement.style.overflowY = 'hidden';
}
function unlockScrollAfterTransition() {
  document.documentElement.style.overflowY = '';
  // style.css also has html:has(#pageTransitionOverlay:not(.transition-done))
  // { overflow-y: hidden; } as a CSS-level backup lock for this same
  // overlay - clearing only the inline style above isn't enough to
  // satisfy that selector, so without this, the moment the browser
  // recalculates the cascade it falls straight back to that rule and
  // scrolling stays dead site-wide even though this function ran
  // correctly. This is the one thing that actually satisfies it.
  if (pageTransitionOverlay) pageTransitionOverlay.classList.add('transition-done');
}

// The overlay is already visible per its own default CSS the instant
// this script runs, so lock immediately, before the browser has a
// chance to settle on whether this page needs a scrollbar.
lockScrollForTransition();

function playEntranceTransition() {
  if (!pageTransitionOverlay) {
    unlockScrollAfterTransition();
    return;
  }
  // Waits for both the original minimum delay and the 3D model being
  // ready (exposed globally by logo3d.js) - unlike the old static PNG,
  // the model loads over the network, so without this the overlay
  // could hide before the logo has actually appeared in it. Capped by
  // a race against a hard maximum so a slow or failed fetch never
  // leaves the overlay stuck indefinitely.
  const modelReady = window.__logoModelReady || Promise.resolve();
  const minDelay = new Promise((resolve) => setTimeout(resolve, 700));
  const maxWait = new Promise((resolve) => setTimeout(resolve, 2500));
  Promise.race([
    Promise.all([modelReady.catch(() => {}), minDelay]),
    maxWait,
  ]).then(() => {
    pageTransitionOverlay.classList.add('is-hidden');
    // Waits for the fade-out's own CSS transition to actually finish
    // before unlocking - tied to the real transitionend event rather
    // than a guessed timeout, so it's exact regardless of the CSS
    // transition's own duration, and the scrollbar can't appear until
    // the overlay has genuinely stopped covering the screen.
    function onFadeOutDone(e) {
      if (e.target !== pageTransitionOverlay || e.propertyName !== 'opacity') return;
      pageTransitionOverlay.removeEventListener('transitionend', onFadeOutDone);
      unlockScrollAfterTransition();
    }
    pageTransitionOverlay.addEventListener('transitionend', onFadeOutDone);
  });
}

function isPageTransitionLink(link) {
  if (!link) return false;
  if (link.classList.contains('hero-logo-link')) return true;
  if (link.closest('.nav')) return true;
  if (link.classList.contains('cover-card')) return true;
  return false;
}

function setupPageTransitionLinks() {
  if (!pageTransitionOverlay) return;

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!isPageTransitionLink(link)) return;
    // let ctrl/cmd/shift-click and middle-click open in a new tab normally
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;

    const href = link.getAttribute('href');
    if (!href) return;

    // clicking the home logo while already on the home page shouldn't
    // reload the page or play the transition at all
    if (link.classList.contains('hero-logo-link') && document.body.classList.contains('home')) {
      e.preventDefault();
      return;
    }

    // same idea, generalized to every other nav link: clicking Артисти
    // while already on the artists page (etc.) shouldn't reload either.
    // Each page's <body> already carries a class matching its own name
    // (body.artists, body.music, body.contacts), so comparing the
    // clicked link's destination slug against that tells us if we're
    // already there.
    if (link.closest('.nav')) {
      const slug = href.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').pop();
      if (slug && document.body.classList.contains(slug)) {
        e.preventDefault();
        return;
      }
    }

    e.preventDefault();

    pageTransitionOverlay.classList.remove('is-hidden');
    lockScrollForTransition();

    setTimeout(() => {
      window.location.href = href;
    }, 550);
  });
}

// Runs immediately (not waiting for DOMContentLoaded/fragments) since
// the overlay element is already present in the page's own static HTML.
playEntranceTransition();

window.addEventListener('pageshow', (event) => {
  if (event.persisted && pageTransitionOverlay) {
    pageTransitionOverlay.classList.add('is-hidden');
    unlockScrollAfterTransition();
  }
});