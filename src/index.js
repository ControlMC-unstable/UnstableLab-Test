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
      if (path === '/' && request.method === 'GET') {
        return new Response('unstable-store worker OK', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    } catch (e) {
      console.error(e);
      return new Response('server error: ' + e.message, { status: 500 });
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

// ===== Helpers =====
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
