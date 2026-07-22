// Shared logic for both index.html (landing) and section.html (products).

const STATE = { username: '', data: null };

// ===== Server IP top bar =====
// Injected on every page so both index.html and section.html get it.
const SERVER_IP = 'PLAY.UNSTABLELAB.XYZ';
const DISCORD_URL = 'https://discord.gg/M8SczA8yWJ';
const EMAIL = 'unstablelab@outlook.com';

// Copy text to clipboard, with a fallback for browsers that don't have
// the async clipboard API (old browsers / non-HTTPS pages).
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(t);
    return ok;
  }
}

// Attach a click handler that copies `text` and shows a brief "Copied!" state.
function wireCopyButton(btn, text) {
  btn.addEventListener('click', async () => {
    await copyToClipboard(text);
    const original = btn.dataset.original || btn.textContent;
    btn.dataset.original = original;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, 1500);
  });
}

(function installIpBar() {
  const bar = document.createElement('div');
  bar.className = 'ip-bar';
  bar.innerHTML = `
    <div class="ip-bar-item">
      <span class="ip-label">Play now on</span>
      <span class="ip-address"></span>
      <button class="copy-btn" type="button" data-copy="ip">Copy</button>
    </div>
    <div class="ip-bar-divider" aria-hidden="true"></div>
    <div class="ip-bar-item">
      <span class="ip-label">Discord</span>
      <a class="discord-link" href="${DISCORD_URL}" target="_blank" rel="noopener">discord.gg/M8SczA8yWJ</a>
      <button class="copy-btn" type="button" data-copy="discord">Copy</button>
    </div>
    <div class="ip-bar-divider" aria-hidden="true"></div>
    <div class="ip-bar-item">
      <span class="ip-label">Email</span>
      <a class="discord-link" href="mailto:${EMAIL}">${EMAIL}</a>
      <button class="copy-btn" type="button" data-copy="email">Copy</button>
    </div>
  `;
  bar.querySelector('.ip-address').textContent = SERVER_IP;

  wireCopyButton(bar.querySelector('[data-copy="ip"]'), SERVER_IP);
  wireCopyButton(bar.querySelector('[data-copy="discord"]'), DISCORD_URL);
  wireCopyButton(bar.querySelector('[data-copy="email"]'), EMAIL);

  document.body.insertBefore(bar, document.body.firstChild);
})();

// ===== Subtle background glow + grain =====
(function installBackground() {
  const glow = document.createElement('div');
  glow.className = 'bg-glow';
  document.body.insertBefore(glow, document.body.firstChild);
  const grain = document.createElement('div');
  grain.className = 'grain';
  document.body.insertBefore(grain, glow.nextSibling);
})();

function showError(msg) {
  const el = document.getElementById('error');
  if (!el) return alert(msg);
  el.textContent = msg;
  el.hidden = false;
}

function isValidUsername(name) {
  return /^[a-zA-Z0-9_]{3,16}$/.test(name);
}

let headUpdateTimer = null;
function updateHead() {
  const head = document.getElementById('head');
  if (!head) return;
  if (!isValidUsername(STATE.username)) {
    head.innerHTML = '?';
    head.classList.remove('loading');
    return;
  }
  clearTimeout(headUpdateTimer);
  head.classList.add('loading');
  headUpdateTimer = setTimeout(() => {
    const img = new Image();
    img.src = `https://mc-heads.net/avatar/${encodeURIComponent(STATE.username)}/56`;
    img.alt = `${STATE.username}'s head`;
    img.onload = () => {
      head.innerHTML = '';
      head.appendChild(img);
      head.classList.remove('loading');
    };
    img.onerror = () => {
      head.innerHTML = '?';
      head.classList.remove('loading');
    };
  }, 350);
}

function saveUsername(name) {
  STATE.username = (name || '').trim();
  try { localStorage.setItem('mc_username', STATE.username); } catch (_) {}
  const status = document.getElementById('status');
  if (status) {
    if (STATE.username) {
      status.textContent = `Ready to purchase as ${STATE.username}.`;
      status.classList.add('saved');
    } else {
      status.textContent = 'Enter your username to enable purchases.';
      status.classList.remove('saved');
    }
  }
  updateHead();
  // Re-render whichever page is active
  if (typeof renderProducts === 'function') renderProducts();
}

function buy(product) {
  if (!isValidUsername(STATE.username)) {
    showError('Please enter a valid Minecraft username (3–16 characters, letters/numbers/underscore) before purchasing.');
    const input = document.getElementById('username');
    if (input) input.focus();
    return;
  }
  const err = document.getElementById('error');
  if (err) err.hidden = true;

  const url = new URL(product.payment_link);
  url.searchParams.set('client_reference_id', STATE.username);
  window.location.href = url.toString();
}

// ===== Cart =====
function getCart() {
  try { return JSON.parse(localStorage.getItem('cart') || '[]'); } catch (_) { return []; }
}
function saveCart(cart) {
  try { localStorage.setItem('cart', JSON.stringify(cart)); } catch (_) {}
  updateCartBadge();
}
function addToCart(product) {
  const cart = getCart();
  const existing = cart.find(i => i.id === product.id);
  if (existing) {
    existing.qty = (existing.qty || 1) + 1;
  } else {
    const entry = {
      id: product.id,
      name: product.name,
      price_display: product.price_display,
      payment_link: product.payment_link,
      description: product.description,
      qty: 1
    };
    if (product.no_quantity) entry.no_quantity = true;
    cart.push(entry);
  }
  saveCart(cart);
  // Brief feedback on the button
  const btn = document.querySelector(`[data-product-id="${product.id}"]`);
  if (btn) {
    const origHTML = btn.innerHTML;
    btn.innerHTML = '✓';
    btn.classList.add('added');
    setTimeout(() => { btn.innerHTML = origHTML; btn.classList.remove('added'); }, 800);
  }
}
function removeFromCart(productId) {
  saveCart(getCart().filter(i => i.id !== productId));
}
function updateCartQty(productId, delta) {
  const cart = getCart();
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.qty = Math.max(1, (item.qty || 1) + delta);
  saveCart(cart);
}
function updateCartBadge() {
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  const count = getCart().reduce((sum, i) => sum + (i.qty || 1), 0);
  badge.textContent = count;
  badge.hidden = count === 0;
}

// ===== Cart button (injected next to username card) =====
(function installCartButton() {
  // Wait for DOM
  function inject() {
    const card = document.querySelector('.username-card');
    if (!card) return;
    const btn = document.createElement('a');
    btn.href = 'cart.html';
    btn.className = 'cart-btn';
    btn.setAttribute('aria-label', 'View cart');
    btn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
      </svg>
      <span class="cart-badge" id="cart-badge" hidden>0</span>
    `;
    card.appendChild(btn);
    updateCartBadge();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();

async function loadData() {
  try {
    const res = await fetch('products.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    STATE.data = await res.json();
  } catch (e) {
    showError('Could not load products.json — check that the file exists and is valid JSON.');
    console.error(e);
    return null;
  }

  // Global branding
  const nameEl = document.getElementById('server-name');
  const tagEl = document.getElementById('server-tagline');
  if (nameEl && STATE.data.server_name) nameEl.textContent = STATE.data.server_name;
  if (tagEl && STATE.data.server_tagline) tagEl.textContent = STATE.data.server_tagline;
  if (STATE.data.accent_color) {
    document.documentElement.style.setProperty('--accent', STATE.data.accent_color);
  }

  // Restore remembered username
  const usernameInput = document.getElementById('username');
  if (usernameInput) {
    try {
      const remembered = localStorage.getItem('mc_username') || '';
      if (remembered) {
        usernameInput.value = remembered;
        saveUsername(remembered);
      } else {
        saveUsername('');
      }
    } catch (_) {
      saveUsername('');
    }
    usernameInput.addEventListener('input', e => saveUsername(e.target.value));
  }

  return STATE.data;
}