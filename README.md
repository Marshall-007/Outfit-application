# Mirror — Virtual Try-On for Any Clothing Site

**See it on _you_ before you buy.** Mirror is a drop-in widget that lets shoppers
try clothes on their own photo — and build outfits from clothes they already own —
on any clothing website, added with a single `<script>` tag.

This repository is a **functional proof-of-concept** built to demonstrate the idea
to a potential retail client. It contains three things served from one small server:

1. **A demo storefront** ("Aurelle & Co.") — stands in for a retailer's site.
2. **The Mirror widget** (`/mirror.js`) — the whole product, embedded like a retailer would.
3. **A tiny API** that talks to Google Gemini to generate the try-on images.

---

## What it does

| Feature | What the shopper sees |
| --- | --- |
| **Try it on** | Uploads one photo, then sees themselves wearing any product — with a before/after slider. |
| **Mirror the model** 🪞 | Turns the store's model photo into a photo of _them_ in the same shot. |
| **My Closet** | Adds photos of clothes they already own (saved in their browser). |
| **Outfit suggestions** | Gemini pairs the store item with their closet and explains why — plus an upsell hint ("missing piece"). |
| **Try on the whole outfit** | Generates a look combining the store item _and_ their own pieces. |

## Why this integration model matters

The retailer **does not need to give us backend access**. The entire integration is:

```html
<script src="https://your-mirror-server.com/mirror.js" defer></script>
```

The widget finds product images in the page, adds a **"Try it on ✨"** button to each,
and calls our server (which holds the AI key). It works two ways:

- **Explicit (recommended):** the retailer tags product images with
  `data-mirror-product`, `data-mirror-name`, `data-mirror-mode` (see
  [`store/product.html`](store/product.html)).
- **Zero-integration (heuristic):** on a page with no tags at all, Mirror finds the
  large product-shaped images by itself — see [`store/embed-test.html`](store/embed-test.html),
  a "foreign" page it was never told about.

---

## Run it

Requires Node 18+ (uses native `fetch`).

```bash
npm install
cp .env.example .env      # optional — see below
npm start                 # http://localhost:3000
```

Open **http://localhost:3000** — the demo store. Click any **Try it on ✨** button.

### With or without an API key

- **No key?** It just works in **demo mode**: canned sample results, clearly badged
  "Sample result". Great for a first look and for offline pitches.
- **With a key?** Put `GEMINI_API_KEY=...` in `.env` (free key at
  <https://aistudio.google.com/apikey>) and restart. Now every try-on is generated
  live from the shopper's photo.
- **Belt and braces:** even with a valid key, if Gemini ever errors or refuses an
  image, that single request **falls back to a sample** so the demo never shows a
  broken state (`demoFallback: true` in the response).

Force demo mode any time with `DEMO_MODE=true` in `.env` — **recommended when
pitching on an unknown network.**

### Optional: generate real assets (needs a key, run once)

The repo ships with lightweight SVG placeholders so it runs with zero cost. To make
it look real:

```bash
npm run generate:products   # AI product photography -> public/images/products/  (~$0.60)
# put a front-facing photo at scripts/demo-user.jpg, then:
npm run generate:canned     # real try-on/outfit results -> public/demo-results/  (for DEMO_MODE)
```

Commit the generated files — after that the demo works forever, online or off.

---

## Demo script (for the client pitch)

1. **Open the store.** "This is a stand-in for your site. Notice the one script tag
   at the bottom of the page — that's the _entire_ integration."
2. **Open the Indigo Denim Jacket.** Hover the model photo → **See it on you 🪞** →
   add your photo → drag the before/after slider. "The model is now _you_."
3. **Click Try it on** on the flat product shot. "Same photo, reused — the shopper
   uploads once."
4. **Open My Closet**, add 2–3 photos of clothes you own, hit **Suggest outfits.**
   Read Gemini's reasoning aloud and point at the **Missing piece** line: "this is
   where you sell them a second item." Then hit **Try on this outfit.**
5. **Open `/embed-test.html`.** "This page has zero Mirror markup. The widget found
   the products by itself — that's how it goes onto a site we don't control."
6. **Close on resilience.** "If the AI is ever down, it degrades to samples instead
   of erroring — your storefront never looks broken."

Run the pitch with `DEMO_MODE=true` and do one genuinely-live generation at step 3
if the network is reliable.

To demo on a phone, expose the local server: `ngrok http 3000`.

---

## How it's built

```
server/          Express: static store, /mirror.js, and the API
  routes/        POST /api/tryon, POST /api/suggest (validation + error mapping)
  providers/     gemini | demo, chosen at startup; gemini errors fall back to demo
  prompts.js     all model prompts in one place
  lib/images.js  data-URL parsing, size/mime checks, server-side image fetch
widget/mirror.js The whole widget: detection, overlay buttons, shadow-DOM modal,
                 closet, before/after slider, localStorage. No build step.
store/           The Aurelle & Co. demo storefront + embed-test.html
public/          Catalog images and canned demo results (manifest.json)
scripts/         One-time asset generators (placeholders / products / canned)
```

**Swapping the AI provider** (e.g. to Replicate IDM-VTON or fal.ai FASHN) is one new
file implementing `tryOn()` + `suggest()` and one line in `server/providers/index.js`.

The API contracts are documented at the top of `server/routes/tryon.js` and
`server/routes/suggest.js`.

---

## Honest limitations (say these in the pitch — they build trust)

- **It's a visualization, not a fitting tool.** The AI produces a realistic
  _approximation_. It does not know garment measurements — there's no size/fit advice,
  and it can occasionally alter garment details.
- **Latency:** roughly 5–15s per generated image. Not for hover-previews.
- **Cost:** about $0.03–0.04 per generated image at scale (pennies for a demo).
- **Privacy:** the shopper's photo is sent to Google's API to create the preview and
  is **never written to disk on our server**. The closet and photo live only in the
  shopper's browser (`localStorage`), per site — they don't follow the user between
  retailers. A production version needs accounts, a privacy policy, and consent UX.
- **Safety:** Google may refuse to generate from some person-photos (notably anyone
  who appears to be a minor), regardless of settings. Mirror degrades gracefully.
- **Heuristic detection is a sketch.** It will mis-fire on carousels, lazy-loaded
  images, and CSS-background product shots. The supported path is the `data-mirror-*`
  attributes; the heuristic exists to _demonstrate_ zero-integration feasibility.

### Explicitly out of scope for this POC

Payments/checkout, user accounts, any server-side storage/database, production-grade
scraping robustness, size recommendation, rate limiting / per-retailer keys,
analytics, mobile apps, i18n, deployment hardening (this is a localhost demo).
