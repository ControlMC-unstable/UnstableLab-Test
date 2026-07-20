# unstable-store worker

Cloudflare Worker that sits between Stripe and your Minecraft plugin.

## What it does

- **POST /webhook** — Stripe calls this after a successful payment. We verify
  the signature and save the order to KV.
- **GET /pending-orders** — The plugin calls this every ~10s. Returns every
  undelivered order.
- **POST /orders/:id/ack** — The plugin calls this after running the commands
  to mark the order delivered.
- **POST /debug/fake-order** — For testing without Stripe. Body:
  `{"username":"Notch","product_id":"supporter"}`

The two plugin endpoints require `Authorization: Bearer <PLUGIN_API_KEY>`.

## First-time setup

You do this once. Cloudflare account is free.

1. Install Node.js (if you don't already have it).
2. In this folder, run:
   ```
   npm install
   npx wrangler login
   ```
3. Create the KV namespace:
   ```
   npx wrangler kv:namespace create ORDERS
   ```
   It prints an `id = "..."`. Paste that id into `wrangler.toml` where it
   says `REPLACE_WITH_KV_ID`.
4. Set your secrets. Pick any random string for the plugin key — it just needs
   to match what the plugin uses.
   ```
   npx wrangler secret put PLUGIN_API_KEY
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
   (For the Stripe secret, use any placeholder for now. You'll replace it with
   the real one from Stripe later.)
5. Deploy:
   ```
   npx wrangler deploy
   ```
   You'll get a URL like `https://unstable-store.<your-account>.workers.dev`.
   That's the URL the plugin will poll.

## Testing without Stripe

Once deployed, you can create a fake order to prove the pipeline works:

```
curl -X POST https://unstable-store.<you>.workers.dev/debug/fake-order \
  -H "Authorization: Bearer <YOUR_PLUGIN_API_KEY>" \
  -H "content-type: application/json" \
  -d '{"username":"Notch","product_id":"supporter"}'
```

Then fetch pending orders:

```
curl https://unstable-store.<you>.workers.dev/pending-orders \
  -H "Authorization: Bearer <YOUR_PLUGIN_API_KEY>"
```

You should see the order in the response. Once the plugin runs the command
it'll POST to `/orders/<id>/ack` and it'll disappear from the pending list.
