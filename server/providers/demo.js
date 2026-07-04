// Canned-results provider. Powers three situations:
//   1. DEMO_MODE=true               (offline pitches — never touches the network)
//   2. no GEMINI_API_KEY set        (zero-config first run)
//   3. per-request fallback         (Gemini errored — degrade instead of failing)
//
// Reads pre-generated files from public/demo-results/ keyed by product id via
// manifest.json, and always degrades to a generic placeholder if no match.
// Populate real canned files with `npm run generate:canned`.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'public', 'demo-results');
const EXT_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function readManifest() {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')); }
  catch (e) { return { _generic: { tryon: 'generic-tryon.svg' } }; }
}

function loadImage(fileName) {
  const file = path.join(DIR, fileName);
  const mimeType = EXT_MIME[path.extname(fileName).toLowerCase()] || 'image/jpeg';
  return { mimeType, data: fs.readFileSync(file).toString('base64') };
}

// Canned responses are delayed so they feel like real generation (and honestly
// represent the latency a client should expect) instead of returning instantly.
function fakeLatency() {
  return new Promise((r) => setTimeout(r, 2000 + Math.floor((Date.now() % 1500))));
}

async function tryOn({ mode, productMeta }) {
  await fakeLatency();
  const manifest = readManifest();
  const key = mode === 'mirror' ? 'mirror' : 'tryon';
  const entry = (productMeta.id && manifest[productMeta.id]) || manifest._generic || {};
  const fileName = entry[key] || entry.tryon || (manifest._generic && manifest._generic.tryon) || 'generic-tryon.svg';
  return { image: loadImage(fileName), provider: 'demo', demoFallback: false };
}

async function suggest({ productMeta, closetItems }) {
  await fakeLatency();
  const manifest = readManifest();
  const entry = productMeta.id && manifest[productMeta.id];
  if (entry && entry.suggest) {
    try {
      const canned = JSON.parse(fs.readFileSync(path.join(DIR, entry.suggest), 'utf8'));
      // Re-map the canned closetItemIds onto the ids actually present in this
      // request (by index) so the widget can always resolve the thumbnails.
      const ids = closetItems.map((c) => c.id);
      canned.suggestions.forEach((s) => {
        s.closetItemIds = (s.closetItemIds || []).map((_, i) => ids[i % ids.length]).filter(Boolean).slice(0, ids.length);
      });
      return { provider: 'demo', suggestions: canned.suggestions };
    } catch (e) { /* fall through to generic */ }
  }
  return { provider: 'demo', suggestions: genericSuggestions(productMeta, closetItems) };
}

function genericSuggestions(productMeta, closetItems) {
  const name = productMeta.name || 'this piece';
  const first = closetItems[0], second = closetItems[1];
  const out = [{
    title: 'Everyday layers',
    closetItemIds: [first.id].concat(second ? [second.id] : []),
    reasoning: `Pair ${name} with your ${first.label}${second ? ` and ${second.label}` : ''} for an easy, balanced look that reads casual but considered.`,
    missingPiece: 'a pair of clean white sneakers',
  }];
  if (closetItems.length >= 2) {
    out.push({
      title: 'Dressed up',
      closetItemIds: closetItems.slice(0, 2).map((c) => c.id),
      reasoning: `Layer ${name} over your ${second ? second.label : first.label} and add a structured piece to take the outfit from day to evening.`,
      missingPiece: 'a slim leather belt',
    });
  }
  return out;
}

module.exports = { name: 'demo', tryOn, suggest };
