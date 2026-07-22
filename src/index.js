// Cloudflare Worker for the Unstable Lab store.
// Uses D1 (SQL database) instead of KV for order storage.
//
// Endpoints:
//   POST /webhook           <- Stripe hits this when a payment succeeds.
//   GET  /pending-orders    <- The Minecraft plugin polls this every ~10s.
//   POST /orders/:id/ack    <- Plugin marks an order as delivered.
//   POST /debug/fake-order  <- Test endpoint (guarded by PLUGIN_API_KEY).

const KNOWN_PRODUCTS = new Set([
  'money-5k', 'money-10k',
  'supporter', 'unstable',
  'key-fireworks-1', 'key-fireworks-3', 'key-fireworks-6',
  'key-maces-1',     'key-maces-3',     'key-maces-6',
]);

// Map Stripe Payment Link IDs to product ID and unit price (in cents).
const PAYMENT_LINK_TO_PRODUCT = {
  'plink_1TvS1cCcqJJ5hDAzcmVF5sPm': { product: 'supporter',       unit_price: 299 },
  'plink_1TvS2RCcqJJ5hDAzPxQvnnOr': { product: 'unstable',        unit_price: 499 },
  'plink_1TvS34CcqJJ5hDAzJIxWWoRo': { product: 'money-5k',        unit_price: 199 },
  'plink_1TvS3cCcqJJ5hDAzPLvDeB1G': { product: 'money-10k',       unit_price: 399 },
  'plink_1TvS49CcqJJ5hDAzNxXVoIRL': { product: 'key-fireworks-1',  unit_price: 99 },
  'plink_1TvS4nCcqJJ5hDAzCH44W6cJ': { product: 'key-fireworks-3',  unit_price: 249 },
  'plink_1TvS5JCcqJJ5hDAzLQedKYJL': { product: 'key-fireworks-6',  unit_price: 449 },
  'plink_1TvS68CcqJJ5hDAzwnLDyknP': { product: 'key-maces-1',     unit_price: 99 },
  'plink_1TvS6YCcqJJ5hDAzAp9nqE1Y': { product: 'key-maces-3',     unit_price: 249 },
  'plink_1TvS77CcqJJ5hDAzGPUj3UTv': { product: 'key-maces-6',     unit_price: 449 },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight BEFORE anything else (including DB init)
    if (path === '/checkout' && request.method === 'OPTIONS') {
      return corsResponse();
    }

    try {
      // Auto-create the orders table if it doesn't exist yet.
      await initDB(env);

      if (path === '/webhook' && request.method === 'POST') {
        return await handleStripeWebhook(request, env);
      }
      if (path === '/pending-orders' && request.method === 'GET') {
        return await handlePendingOrders(request, env);
      }
      if (path.startsWith('/orders/') && path.endsWith('/ack') && request.method === 'POST') {
        const id = path.slice('/orders/'.length, -'/ack'.length);
        return await handleAck(id, request, env);
      }
      if (path === '/debug/fake-order' && request.method === 'POST') {
        return await handleFakeOrder(request, env);
      }
      if (path === '/checkout' && request.method === 'POST') {
        return await handleCheckout(request, env);
      }
      if (path === '/' && request.method === 'GET') {
        return new Response('unstable-store worker OK', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    } catch (e) {
      console.error(e);
      // Include CORS headers on errors so the browser can read the message
      return corsJson({ error: 'server error: ' + e.message }, 500);
    }
  },
};

// ===== DB init =====
async function initDB(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, username TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER DEFAULT 1, amount_total INTEGER DEFAULT 0, currency TEXT DEFAULT 'usd', created_at INTEGER, source TEXT, delivered_at INTEGER)`
  ).run();
}

// ===== Auth for the plugin endpoints =====
function requireApiKey(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const expected = 'Bearer ' + env.PLUGIN_API_KEY;
  if (!env.PLUGIN_API_KEY || auth !== expected) {
    return new Response('unauthorized', { status: 401 });
  }
  return null;
}

// ===== Stripe webhook =====
async function handleStripeWebhook(request, env) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });

  const rawBody = await request.text();
  const ok = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('bad signature', { status: 400 });

  const event = JSON.parse(rawBody);

  if (event.type !== 'checkout.session.completed') {
    return new Response('ignored', { status: 200 });
  }

  const session = event.data.object;
  const username = session.client_reference_id;

  // Cart checkout — metadata.cart contains a JSON array of {id, qty}
  if (session.metadata && session.metadata.source === 'cart_checkout' && session.metadata.cart) {
    let cartItems;
    try { cartItems = JSON.parse(session.metadata.cart); } catch (_) {
      console.error('bad cart metadata');
      return new Response('bad cart', { status: 200 });
    }
    if (!username) {
      console.error('cart checkout missing username');
      return new Response('missing username', { status: 200 });
    }
    for (let i = 0; i < cartItems.length; i++) {
      const ci = cartItems[i];
      if (!KNOWN_PRODUCTS.has(ci.id)) {
        console.error('unknown product in cart', ci.id);
        continue;
      }
      const orderId = session.id + '_item_' + i;
      await env.DB.prepare(
        `INSERT OR IGNORE INTO orders (id, username, product_id, quantity, amount_total, currency, created_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        orderId, username, ci.id, ci.qty || 1,
        0, session.currency || 'usd',
        Date.now(), 'stripe_cart'
      ).run();
    }
    return new Response('ok', { status: 200 });
  }

  // Single-item purchase via Payment Link
  let productId = session.metadata && session.metadata.product_id;
  let quantity = 1;
  if (!productId && session.payment_link) {
    const linkInfo = PAYMENT_LINK_TO_PRODUCT[session.payment_link];
    if (linkInfo) {
      productId = linkInfo.product;
      if (linkInfo.unit_price && session.amount_total) {
        quantity = Math.round(session.amount_total / linkInfo.unit_price);
        if (quantity < 1) quantity = 1;
      }
    }
  }

  if (!username || !productId) {
    console.error('missing username or product_id', { username, productId });
    return new Response('missing fields', { status: 200 });
  }
  if (!KNOWN_PRODUCTS.has(productId)) {
    console.error('unknown product_id', productId);
    return new Response('unknown product', { status: 200 });
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO orders (id, username, product_id, quantity, amount_total, currency, created_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    session.id, username, productId, quantity,
    session.amount_total || 0, session.currency || 'usd',
    Date.now(), 'stripe'
  ).run();

  return new Response('ok', { status: 200 });
}

// ===== Plugin endpoints =====
async function handlePendingOrders(request, env) {
  const unauth = requireApiKey(request, env);
  if (unauth) return unauth;

  const { results } = await env.DB.prepare(
    `SELECT id, username, product_id, quantity, amount_total, currency, created_at, source
     FROM orders WHERE delivered_at IS NULL`
  ).all();

  return jsonResponse({ orders: results || [] });
}

async function handleAck(id, request, env) {
  const unauth = requireApiKey(request, env);
  if (unauth) return unauth;

  const { meta } = await env.DB.prepare(
    `UPDATE orders SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL`
  ).bind(Date.now(), id).run();

  if (meta.changes === 0) {
    return new Response('not found or already delivered', { status: 404 });
  }
  return jsonResponse({ ok: true });
}

// ===== Debug endpoint =====
async function handleFakeOrder(request, env) {
  const unauth = requireApiKey(request, env);
  if (unauth) return unauth;

  const body = await request.json();
  if (!body.username || !body.product_id) {
    return new Response('need username + product_id', { status: 400 });
  }
  if (!KNOWN_PRODUCTS.has(body.product_id)) {
    return new Response('unknown product', { status: 400 });
  }

  const id = 'test_' + crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO orders (id, username, product_id, quantity, amount_total, currency, created_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, body.username, body.product_id, body.quantity || 1,
    0, 'usd', Date.now(), 'debug'
  ).run();

  return jsonResponse({ ok: true, id });
}

// ===== Cart checkout — creates a Stripe Checkout Session =====
async function handleCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return corsJson({ error: 'Stripe secret key not configured' }, 500);
  }

  let body;
  try { body = await request.json(); } catch (_) {
    return corsJson({ error: 'invalid JSON' }, 400);
  }

  const { username, items } = body;
  if (!username || !/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
    return corsJson({ error: 'invalid username' }, 400);
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    return corsJson({ error: 'items must be an array (1-20)' }, 400);
  }

  // Build Stripe line_items
  const lineItems = [];
  for (const item of items) {
    if (!item.price_id || !item.price_id.startsWith('price_')) {
      return corsJson({ error: `invalid price_id for ${item.id}` }, 400);
    }
    if (!KNOWN_PRODUCTS.has(item.id)) {
      return corsJson({ error: `unknown product: ${item.id}` }, 400);
    }
    const qty = Math.max(1, Math.min(100, parseInt(item.qty) || 1));
    lineItems.push({ price: item.price_id, quantity: qty });
  }

  // Build the metadata so the webhook can create one order per line item.
  // We pack the cart into metadata as JSON.
  const cartMeta = items.map(i => ({
    id: i.id,
    qty: Math.max(1, Math.min(100, parseInt(i.qty) || 1))
  }));

  // Create Stripe Checkout Session via API
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('client_reference_id', username);
  params.append('success_url', (body.success_url || 'https://store.unstablelab.xyz') + '?checkout=success');
  params.append('cancel_url', (body.cancel_url || 'https://store.unstablelab.xyz') + '/cart.html');
  params.append('metadata[cart]', JSON.stringify(cartMeta));
  params.append('metadata[source]', 'cart_checkout');

  for (let i = 0; i < lineItems.length; i++) {
    params.append(`line_items[${i}][price]`, lineItems[i].price);
    params.append(`line_items[${i}][quantity]`, lineItems[i].quantity);
    // Allow quantity adjustment on ranks? No — keep adjustable only for non-rank items
    const isRank = ['supporter', 'unstable'].includes(items[i].id);
    if (!isRank) {
      params.append(`line_items[${i}][adjustable_quantity][enabled]`, 'true');
      params.append(`line_items[${i}][adjustable_quantity][minimum]`, '1');
      params.append(`line_items[${i}][adjustable_quantity][maximum]`, '100');
    }
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(env.STRIPE_SECRET_KEY + ':'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const session = await res.json();
  if (!res.ok) {
    console.error('Stripe error:', JSON.stringify(session));
    return corsJson({ error: session.error?.message || 'Stripe error' }, 500);
  }

  return corsJson({ url: session.url });
}

// ===== Helpers =====
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function corsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
function corsJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function verifyStripeSignature(payload, header, secret) {
  if (!secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map(p => {
      const [k, v] = p.split('=');
      return [k, v];
    })
  );
  const timestamp = parts.t;
  const provided = parts.v1;
  if (!timestamp || !provided) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${payload}`)
  );
  const expected = [...new Uint8Array(sig)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}