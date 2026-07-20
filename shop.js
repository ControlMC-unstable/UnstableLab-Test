// Shared logic for both index.html (landing) and section.html (products).

const STATE = { username: '', data: null };

// ===== Server IP top bar =====
// Injected on every page so both index.html and section.html get it.
const SERVER_IP = 'PLAY.UNSTABLELAB.XYZ';
const DISCORD_URL = 'https://discord.gg/M8SczA8yWJ';

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
  `;
  bar.querySelector('.ip-address').textContent = SERVER_IP;

  wireCopyButton(bar.querySelector('[data-copy="ip"]'), SERVER_IP);
  wireCopyButton(bar.querySelector('[data-copy="discord"]'), DISCORD_URL);

  document.body.insertBefore(bar, document.body.firstChild);
})();

// ===== Background effects =====
// Injects the fixed background layers so we don't have to duplicate them in
// every HTML file, and wires up the cursor-following spotlight/magnifier.
(function installBackground() {
  const layers = ['bg-fallback', 'bg', 'bg-zoom', 'bg-overlay', 'spotlight'];
  for (const cls of layers) {
    const el = document.createElement('div');
    el.className = cls;
    // Insert at the very start so the IP bar (added earlier) stays on top of them.
    document.body.insertBefore(el, document.body.firstChild);
  }

  // Throttle mousemove with requestAnimationFrame so we don't thrash on
  // high-refresh-rate mice.
  let pendingX = null, pendingY = null, rafPending = false;
  function flush() {
    document.documentElement.style.setProperty('--mx', pendingX + 'px');
    document.documentElement.style.setProperty('--my', pendingY + 'px');
    rafPending = false;
  }
  window.addEventListener('mousemove', e => {
    pendingX = e.clientX;
    pendingY = e.clientY;
    if (!rafPending) { rafPending = true; requestAnimationFrame(flush); }
  }, { passive: true });
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
