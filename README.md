# Unstable Lab Store — GitHub Pages front-end

A fully static store site. The player enters their Minecraft username,
clicks a product, and gets sent to Stripe Checkout. Stripe records the
username alongside the payment. Later, a small backend + a plugin on
your Minecraft server will read the paid orders and deliver them
in-game — those are the next steps, not this one.

## What this step gives you

- A live store page you can share with anyone.
- Editable products via `products.json` — no HTML changes.
- Working Stripe checkout for each product.
- Username is captured and passed to Stripe so we can later match
  payments to players.

## What this step does NOT do (yet)

- Actually deliver anything in-game. Buying right now just charges the
  card; nothing happens on the server until the plugin/backend are
  wired up.
- Handle refunds, admin views, order history — later.

---

## The logo

Save your Unstable Lab logo image into this folder as `logo.png` before
uploading. The page tries `logo.png` first and falls back to the
included `logo.svg` placeholder if the PNG isn't there — so it works
either way, but your PNG will look better.

## Deploy to GitHub Pages

1. Create a new public GitHub repository (name it whatever, e.g. `store`).
2. Upload `index.html`, `products.json`, `logo.svg`, your `logo.png`, and this `README.md`.
3. In the repo, go to **Settings → Pages**.
4. Under **Source**, pick **Deploy from a branch**, branch `main`, folder `/ (root)`.
5. Save. Wait ~30 seconds. Your site is live at
   `https://<your-username>.github.io/<repo-name>/`.

You can also drag the folder into `github.com/new` if you're new to git.

## Set up Stripe payment links

Each product needs its own Stripe Payment Link. In the Stripe dashboard:

1. Sign in at [dashboard.stripe.com](https://dashboard.stripe.com). Toggle
   **Test mode** on (top right) while you're setting this up — real card
   numbers won't be charged.
2. **Product catalog → Add product** for each item (name + one-time price).
3. **Payment Links → New**. Pick the product. Under **Advanced options**
   make sure "Prefill customer information from URL" style options are
   fine (defaults are fine). Create the link.
4. Copy the resulting `https://buy.stripe.com/…` URL and paste it into
   `products.json` as that product's `payment_link`.

That's it — no key handling on the front-end. Stripe Payment Links are
public URLs.

## Edit the products

Open `products.json` and change/add/remove entries. The page reads it
at load time; refresh the browser to see changes. Fields:

| Field | Meaning |
|-------|---------|
| `server_name` | Big heading on the page |
| `server_tagline` | Subtitle under the heading |
| `accent_color` | Brand color (buttons, price text). Any CSS color. |
| `products[].id` | Short internal ID (used later by the plugin) |
| `products[].name` | Card title |
| `products[].description` | Card body text |
| `products[].price_display` | What shows on the card (e.g. "$5") — this is just text, the real price lives in Stripe |
| `products[].payment_link` | The Stripe Payment Link URL |

The **displayed price is decorative** — Stripe charges whatever the
Payment Link says. Keep them in sync manually.

## Test the flow end-to-end

1. Open the site.
2. Type any valid Minecraft username (3–16 chars, letters/numbers/underscore).
3. Click a Buy button — you should land on Stripe's checkout page.
4. Use Stripe's test card: `4242 4242 4242 4242`, any future date, any CVC.
5. Complete the payment. You'll be sent to Stripe's default success page.
6. In your Stripe dashboard → **Payments**, click the new payment. Under
   **Metadata / Client reference ID** you should see the username you typed.

If step 6 works, everything on the store side is done. When we build
the backend, it reads exactly that `client_reference_id` field to know
who to deliver the item to.

## Common pitfalls

- **Products don't load**: `products.json` is invalid JSON. Paste it into
  [jsonlint.com](https://jsonlint.com/) to find the typo.
- **"Buy" button stays disabled**: enter a valid MC username.
- **You edited `products.json` and nothing changed**: hard-refresh
  (Ctrl-Shift-R / Cmd-Shift-R). GitHub Pages caches for a minute or two.
