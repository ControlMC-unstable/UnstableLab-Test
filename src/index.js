// Cloudflare Worker for the Unstable Lab store.
//
// Two jobs:
//   POST /webhook           <- Stripe hits this when a payment succeeds.
//                              We save the order to KV keyed by a unique id.
//   GET  /pending-orders    <- The Minecraft plugin hits this every ~10s.
//                              We return all undelivered orders. The plugin
//                              runs the commands, then calls...
//   POST /orders/:id/ack    <- ...to mark them delivered.
//
// One test endpoint so you can verify everything without Stripe:
//   POST /debug/fake-order  <- Body: {"username":"Notch","product_id":"supporter"}
//                              Creates a pending order as if a payment succeeded.
//                              Guarded by PLUGIN_API_KEY so no one else can use it.

// Which Stripe product IDs map to which in-game action.
// The plugin has its OWN copy of this mapping (product_id -> command) — the
// Worker just stores the product_id and the plugin decides what to run.
// This is the list of valid ids the Worker accepts, nothing more.
const KNOWN_PRODUCTS = new Set([
  'money-5k', 'money-10k',
  'supporter', 'unstable',
  'key-fireworks-1', 'key-fireworks-3', 'key-fireworks-6',
  'key-maces-1',     'key-maces-3',     'key-maces-6',
]);

// Map Stripe Payment Link IDs to product IDs.
// This lets us identify the product without needing metadata on the Payment Link.
// Add each Payment Link's plink_ ID here.
const PAYMENT_LINK_TO_PRODUCT = {
  'plink_1TvS1cCcqJJ5hDAzcmVF5sPm': 'supporter',
  'plink_1TvS2RCcqJJ5hDAzPxQvnnOr': 'unstable',
  'plink_1TvS34CcqJJ5hDAzJIxWWoRo': 'money-5k',
  'plink_1TvS3cCcqJJ5hDAzPLvDeB1G': 'money-10k',
  'plink_1TvS49CcqJJ5hDAzNxXVoIRL': 'key-fireworks-1',
  'plink_1TvS4nCcqJJ5hDAzCH44W6cJ': 'key-fireworks-3',
  'plink_1TvS5JCcqJJ5hDAzLQedKYJL': 'key-fireworks-6',
  'plink_1TvS68CcqJJ5hDAzwnLDyknP': 'key-maces-1',
  'plink_1TvS6YCcqJJ5hDAzAp9nqE1Y': 'key-maces-3',
  'plink_1TvS77CcqJJ5hDAzGPUj3UTv': 'key-maces-6',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
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

// ===== Auth for the plugin endpoints =====
function requireApiKey(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const expected = 'Bearer ' + env.PLUGIN_API_KEY;
  // constant-time compare would be nicer but this is fine for a small server
  if (!env.PLUGIN_API_KEY || auth !== expected) {
    return new Response('unauthorized', { status: 401 });
  }
  return null;
}

// ===== Stripe webhook =====
// Stripe signs every webhook with your STRIPE_WEBHOOK_SECRET so you can be sure
// the request really came from Stripe and not some random person hitting your
// URL. We verify the signature before trusting the body.
async function handleStripeWebhook(request, env) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });

  const rawBody = await request.text();
  const ok = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('bad signature', { status: 400 });

  const event = JSON.parse(rawBody);

  // Only care about successful payments.
  // `checkout.session.completed` fires once per successful Payment Link checkout.
  if (event.type !== 'checkout.session.completed') {
    return new Response('ignored', { status: 200 });
  }

  const session = event.data.object;
  const username = session.client_reference_id;
  // Try metadata first, then fall back to looking up the Payment Link ID.
  let productId = session.metadata && session.metadata.product_id;
  if (!productId && session.payment_link) {
    productId = PAYMENT_LINK_TO_PRODUCT[session.payment_link];
  }

  if (!username || !productId) {
    console.error('missing username or product_id', { username, productId });
    return new Response('missing fields', { status: 200 }); // 200 so Stripe stops retrying
  }
  if (!KNOWN_PRODUCTS.has(productId)) {
    console.error('unknown product_id', productId);
    return new Response('unknown product', { status: 200 });
  }

  await saveOrder(env, {
    id: session.id,               // Stripe's session id, guaranteed unique
    username,
    product_id: productId,
    amount_total: session.amount_total,
    currency: session.currency,
    created_at: Date.now(),
    source: 'stripe',
  });

  return new Response('ok', { status: 200 });
}

// ===== Plugin endpoints =====
async function handlePendingOrders(request, env) {
  const unauth = requireApiKey(request, env);
  if (unauth) return unauth;

  // List every order key. For a small server this is cheap; if orders ever grow
  // huge you'd switch to a "pending:" prefix and delete on ack instead.
  const list = await env.ORDERS.list({ prefix: 'order:' });
  const orders = [];
  for (const key of list.keys) {
    const raw = await env.ORDERS.get(key.name);
    if (!raw) continue;
    const order = JSON.parse(raw);
    if (!order.delivered_at) orders.push(order);
  }
  return jsonResponse({ orders });
}

async function handleAck(id, request, env) {
  const unauth = requireApiKey(request, env);
  if (unauth) return unauth;

  const key = 'order:' + id;
  const raw = await env.ORDERS.get(key);
  if (!raw) return new Response('not found', { status: 404 });

  const order = JSON.parse(raw);
  order.delivered_at = Date.now();
  await env.ORDERS.put(key, JSON.stringify(order));
  return jsonResponse({ ok: true });
}

// ===== Debug endpoint (no Stripe involved) =====
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
  await saveOrder(env, {
    id,
    username: body.username,
    product_id: body.product_id,
    amount_total: 0,
    currency: 'usd',
    created_at: Date.now(),
    source: 'debug',
  });
  return jsonResponse({ ok: true, id });
}

// ===== Helpers =====
async function saveOrder(env, order) {
  await env.ORDERS.put('order:' + order.id, JSON.stringify(order));
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Verify a Stripe webhook signature manually (Workers can't use the stripe-node
// SDK because it needs Node crypto). This does exactly what Stripe's library
// does: split the header, HMAC-SHA256 the "timestamp.body" string with your
// signing secret, compare against the "v1" signature.
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
  // Constant-time compare
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}
