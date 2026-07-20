# Unstable Lab Store — GitHub Pages front-end

A fully static store site with a landing page and three category pages
(Money, Ranks, Crate Keys). Players enter their Minecraft username,
pick a category, and check out through Stripe.

## Files

| File | What it is |
|------|-----------|
| `index.html` | Landing page — shows the three category cards |
| `section.html` | Category page — shows products in one category (uses `?id=` query param) |
| `style.css` | All the styling for both pages |
| `shop.js` | Shared JS: loads products, username handling, buy button |
| `products.json` | **The one file you edit to add/change products or categories** |
| `logo.png` | Your Unstable Lab logo (drop it in — falls back to `logo.svg` if missing) |
| `logo.svg` | Placeholder logo so the site works before you add `logo.png` |
| `background.png` | **The background image** — save your Unstable Lab screenshot here |

## The background and logo

- Save your **Unstable Lab minecraft screenshot** as `background.png` in
  this folder. It becomes the site's background (fixed, covered by a
  dark gradient so text stays readable).
- Save your **flask logo** as `logo.png` in this folder.

If either file is missing, the site still works — it just uses a
fallback gradient / the placeholder SVG.

## Deploy to GitHub Pages

1. Create a new public GitHub repository (name it whatever, e.g. `store`).
2. Upload everything in this folder (all 8 files including your `logo.png`
   and `background.png`).
3. In the repo, go to **Settings → Pages**.
4. Under **Source**, pick **Deploy from a branch**, branch `main`, folder `/ (root)`.
5. Save. Wait ~30 seconds. Your site is live at
   `https://<your-username>.github.io/<repo-name>/`.

## Editing products and categories

Everything visible is in `products.json`:

```json
{
  "server_name": "Unstable Lab Store",
  "server_tagline": "...",
  "accent_color": "#8b5cf6",
  "sections": [
    {
      "id": "money",
      "name": "Money",
      "icon": "💰",
      "description": "In-game currency packs.",
      "products": [
        { "id": "money-small", "name": "$10,000 in-game", "description": "...", "price_display": "$2", "payment_link": "https://buy.stripe.com/..." }
      ]
    }
  ]
}
```

- **Add a new category**: add a new object to `sections`. It appears on
  the landing page as a clickable card automatically.
- **Add a product to a category**: add a new object to that section's
  `products` array.
- **Icon**: any emoji works. Search "emoji picker" if you need one.
- **Change the accent color**: `accent_color`. Any CSS color (hex, name).

You do NOT need to touch any HTML or CSS to add products. Just edit
`products.json`, commit, wait ~30 seconds for GitHub Pages to redeploy.

## Set up Stripe payment links

Each product needs its own Stripe Payment Link. In the Stripe dashboard:

1. Sign in at [dashboard.stripe.com](https://dashboard.stripe.com).
   Toggle **Test mode** on (top right) while you're setting this up —
   real card numbers won't be charged.
2. **Product catalog → Add product** for each item (name + one-time price).
3. **Payment Links → New**. Pick the product. Defaults are fine.
4. Copy the `https://buy.stripe.com/…` URL into `products.json`.

## Test the flow end-to-end

1. Open the site.
2. Type any valid Minecraft username (3–16 chars, letters/numbers/underscore).
3. Click **Browse →** on any category.
4. Click a **Buy** button — you should land on Stripe's checkout page.
5. Use Stripe's test card: `4242 4242 4242 4242`, any future date, any CVC.
6. In your Stripe dashboard → **Payments**, click the new payment. Under
   **Client reference ID** you should see the username you typed. That's
   how the backend (next step) will know who to deliver the item to.

## Common pitfalls

- **Products don't load**: `products.json` is invalid JSON. Paste it into
  [jsonlint.com](https://jsonlint.com/) to find the typo.
- **You edited a file and nothing changed**: hard-refresh
  (Ctrl-Shift-R / Cmd-Shift-R). GitHub Pages caches for a minute or two.
- **Logo/background changed but browser shows old one**: browsers
  aggressively cache images. Rename to `logo2.png` and update the reference,
  or add `?v=2` to the URL in the HTML.
