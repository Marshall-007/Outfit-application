// Generates SVG placeholder catalog images so the demo store works with zero
// API cost. Run `npm run generate:products` (needs GEMINI_API_KEY) to replace
// these with real AI-generated product photography.
const fs = require('fs');
const path = require('path');

const products = require('../store/products.json');
const outDir = path.join(__dirname, '..', 'public', 'images', 'products');
fs.mkdirSync(outDir, { recursive: true });

function lighten(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.min(255, Math.round(((n >> shift) & 0xff) + (255 - ((n >> shift) & 0xff)) * amount));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function svg({ emoji, name, color, kind }) {
  const bgTop = lighten(color, 0.82);
  const bgBottom = lighten(color, 0.65);
  const caption = kind === 'model' ? 'Model shot' : 'Product shot';
  const figure = kind === 'model' ? '🧍' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${bgTop}"/>
      <stop offset="1" stop-color="${bgBottom}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1000" fill="url(#bg)"/>
  <circle cx="400" cy="430" r="210" fill="#ffffff" opacity="0.45"/>
  <text x="400" y="500" text-anchor="middle" font-size="${figure ? 150 : 190}">${figure}${emoji}</text>
  <text x="400" y="720" text-anchor="middle" font-family="Georgia, serif" font-size="40" fill="${color}">${name}</text>
  <text x="400" y="765" text-anchor="middle" font-family="sans-serif" font-size="22" fill="${color}" opacity="0.75">${caption} · placeholder</text>
  <text x="400" y="950" text-anchor="middle" font-family="sans-serif" font-size="17" fill="${color}" opacity="0.55">run "npm run generate:products" for AI photography</text>
</svg>`;
}

for (const p of products) {
  fs.writeFileSync(path.join(outDir, `${p.id}-flat.svg`), svg({ ...p, kind: 'flat' }));
  fs.writeFileSync(path.join(outDir, `${p.id}-model.svg`), svg({ ...p, kind: 'model' }));
  console.log(`wrote ${p.id}-flat.svg + ${p.id}-model.svg`);
}
console.log(`\nDone: ${products.length * 2} placeholders in public/images/products/`);
