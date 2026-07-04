// One-time canned-result generation for DEMO_MODE.
//
// Runs real Gemini try-on / mirror / suggest calls with a reference photo and
// writes the results into public/demo-results/ + updates manifest.json. After
// this, the whole app runs convincingly with NO network (set DEMO_MODE=true),
// which is how you should drive a live client pitch.
//
//   1. GEMINI_API_KEY in .env
//   2. Put a clear, front-facing photo of the demo driver at scripts/demo-user.jpg
//   3. npm run generate:canned
//   4. Commit public/demo-results/*
//
// Uses the running server's own provider code so the outputs match live behavior.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const products = require('../store/products.json');
const gemini = require('../server/providers/gemini');
const { imageFromDataUrl, imageFromUrl } = require('../server/lib/images');

const OUT = path.join(__dirname, '..', 'public', 'demo-results');
const REF = path.join(__dirname, 'demo-user.jpg');
const BASE = process.env.DEMO_ASSET_BASE || 'http://localhost:3000';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set (see .env.example).'); process.exit(1);
}
if (!fs.existsSync(REF)) {
  console.error('Missing scripts/demo-user.jpg — add a front-facing reference photo first.'); process.exit(1);
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function refImage() {
  const b64 = fs.readFileSync(REF).toString('base64');
  return imageFromDataUrl(`data:image/jpeg;base64,${b64}`, 'demo-user.jpg');
}

// A tiny fixture closet so suggest() has something real to reason about.
async function fixtureCloset() {
  const picks = ['black-jeans', 'linen-shirt'];
  const items = [];
  for (const id of picks) {
    const p = products.find((x) => x.id === id);
    try {
      const img = await imageFromUrl(`${BASE}${p.flatImage}`, id);
      items.push({ id: `c-${id}`, label: p.name.toLowerCase(), image: img });
    } catch (e) { /* skip pieces still on SVG placeholders */ }
  }
  return items;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { _generic: { tryon: 'generic-tryon.svg' } };
  const user = refImage();
  const closet = await fixtureCloset();

  for (const p of products) {
    const entry = {};
    for (const mode of ['tryon', 'mirror']) {
      const srcPath = mode === 'mirror' ? p.modelImage : p.flatImage;
      process.stdout.write(`${p.id} ${mode} ... `);
      try {
        const garment = await imageFromUrl(`${BASE}${srcPath}`, `${p.id} ${mode}`);
        const res = await gemini.tryOn({ mode, userImage: user, garmentImages: [garment], productMeta: { id: p.id, name: p.name } });
        const file = `${mode}-${p.id}.${EXT[res.image.mimeType] || 'jpg'}`;
        fs.writeFileSync(path.join(OUT, file), Buffer.from(res.image.data, 'base64'));
        entry[mode] = file;
        console.log('ok');
      } catch (e) { console.log(`skipped (${e.code || e.message})`); }
    }

    if (closet.length) {
      process.stdout.write(`${p.id} suggest ... `);
      try {
        const product = await imageFromUrl(`${BASE}${p.flatImage}`, p.id);
        const res = await gemini.suggest({ productImage: product, productMeta: { id: p.id, name: p.name, category: p.category }, closetItems: closet });
        const file = `suggest-${p.id}.json`;
        fs.writeFileSync(path.join(OUT, file), JSON.stringify({ suggestions: res.suggestions }, null, 2));
        entry.suggest = file;
        console.log('ok');
      } catch (e) { console.log(`skipped (${e.code || e.message})`); }
    }

    if (Object.keys(entry).length) manifest[p.id] = entry;
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('\nWrote canned results + manifest.json. Review, then commit public/demo-results/.');
})();
