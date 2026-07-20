// Shared logic for both index.html (landing) and section.html (products).

const STATE = { username: '', data: null };

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
