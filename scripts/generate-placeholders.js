// Generates clean, emoji-free SVG placeholder cards so the demo store runs with
// zero API cost. These are obvious stand-ins (labelled "awaiting photography")
// — run `npm run generate:products` with a GEMINI_API_KEY to replace them with
// real product/model photography.
const fs = require('fs');
const path = require('path');

const products = require('../store/products.json');
const outDir = path.join(__dirname, '..', 'public', 'images', 'products');
fs.mkdirSync(outDir, { recursive: true });

function mix(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.round(((n >> shift) & 0xff) + (255 - ((n >> shift) & 0xff)) * amount);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function card({ name, category, color, kind }) {
  const bgTop = mix(color, 0.9);
  const bgBottom = mix(color, 0.74);
  const ink = mix(color, -0.2 < 0 ? 0 : 0); // keep the product color as ink
  const label = kind === 'model' ? 'Model shot' : 'Product shot';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${bgTop}"/>
      <stop offset="1" stop-color="${bgBottom}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="1000" fill="url(#bg)"/>
  <rect x="40" y="40" width="720" height="920" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="400" y="150" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" letter-spacing="4" fill="${color}" opacity="0.8">${esc(category.toUpperCase())}</text>
  <text x="400" y="510" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="46" fill="${color}">${esc(name)}</text>
  <line x1="330" y1="560" x2="470" y2="560" stroke="${color}" stroke-width="1.5" opacity="0.5"/>
  <text x="400" y="600" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" letter-spacing="2" fill="${color}" opacity="0.7">${label.toUpperCase()}</text>
  <text x="400" y="915" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="${color}" opacity="0.55">Awaiting photography — run npm run generate:products</text>
</svg>`;
}

for (const p of products) {
  fs.writeFileSync(path.join(outDir, `${p.id}-flat.svg`), card({ ...p, kind: 'flat' }));
  fs.writeFileSync(path.join(outDir, `${p.id}-model.svg`), card({ ...p, kind: 'model' }));
  console.log(`wrote ${p.id}-flat.svg + ${p.id}-model.svg`);
}
console.log(`\nDone: ${products.length * 2} placeholders in public/images/products/`);
