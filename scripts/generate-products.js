// One-time catalog generation: creates real product photography for the demo
// store using Gemini text->image, replacing the SVG placeholders.
//
//   1. Put GEMINI_API_KEY in .env  (free key: https://aistudio.google.com/apikey)
//   2. npm run generate:products
//   3. Commit the generated JPGs + updated products.json
//
// Cost: ~16 images, roughly $0.60 total. Run once; outputs are committed.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const MODEL = 'gemini-2.5-flash-image';
const productsPath = path.join(__dirname, '..', 'store', 'products.json');
const outDir = path.join(__dirname, '..', 'public', 'images', 'products');

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set. Add it to .env first (see .env.example).');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function prompts(p) {
  return {
    flat: `Professional e-commerce product photograph of ${p.description} The garment is a ${p.name.toLowerCase()}, laid flat / ghost-mannequin style on a light warm-gray studio background, soft even lighting, no people, no text, portrait orientation 4:5.`,
    model: `Full-body studio fashion photograph of a model wearing ${p.name.toLowerCase()} (${p.description}) styled with simple neutral basics, standing naturally, warm light-gray seamless background, soft editorial lighting, photorealistic, no text, portrait orientation 4:5.`,
  };
}

async function generateImage(prompt) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseModalities: ['IMAGE', 'TEXT'] },
  });
  const parts = response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part.inlineData);
  if (!imagePart) {
    throw new Error(`No image returned (finishReason: ${response.candidates?.[0]?.finishReason || 'unknown'})`);
  }
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

(async () => {
  const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  for (const p of products) {
    const { flat, model } = prompts(p);
    for (const [kind, prompt] of [['flat', flat], ['model', model]]) {
      const file = `${p.id}-${kind}.jpg`;
      process.stdout.write(`Generating ${file} ... `);
      try {
        const buffer = await generateImage(prompt);
        fs.writeFileSync(path.join(outDir, file), buffer);
        p[`${kind}Image`] = `/assets/images/products/${file}`;
        console.log(`ok (${Math.round(buffer.length / 1024)}KB)`);
      } catch (err) {
        console.log(`FAILED: ${err.message} — keeping placeholder`);
      }
    }
  }

  fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n');
  console.log('\nUpdated store/products.json image paths. Review the images, then commit.');
})();
