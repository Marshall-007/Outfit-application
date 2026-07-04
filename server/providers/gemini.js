// Real provider: Google Gemini via the @google/genai SDK.
//
// Try-on / mirror use the image-editing model gemini-2.5-flash-image: we send
// the user photo + garment image(s) + a text instruction and read back the
// generated image. Suggestions use gemini-2.5-flash with structured JSON output.
const { GoogleGenAI } = require('@google/genai');
const prompts = require('../prompts');
const { GEMINI_MIMES } = require('../lib/images');
const { ApiError } = require('../lib/errors');

const IMAGE_MODEL = 'gemini-2.5-flash-image';
const TEXT_MODEL = 'gemini-2.5-flash';

let ai = null;
function client() {
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

// Gemini can't ingest SVG (our placeholder catalog). Signal the caller so it
// can fall back to a canned demo result instead of erroring the whole request.
function assertGeminiCompatible(image, label) {
  if (!GEMINI_MIMES.includes(image.mimeType)) {
    throw new ApiError(422, 'UNSUPPORTED_IMAGE', `${label} is ${image.mimeType}; Gemini needs JPEG/PNG/WebP`);
  }
}

function inlinePart(image) {
  return { inlineData: { mimeType: image.mimeType, data: image.data } };
}

function extractImage(response) {
  const candidate = response.candidates && response.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  const imagePart = parts.find((p) => p.inlineData && p.inlineData.data);
  if (imagePart) {
    return { mimeType: imagePart.inlineData.mimeType || 'image/png', data: imagePart.inlineData.data };
  }
  // No image came back — figure out why so callers can react (safety vs generic).
  const finish = candidate && candidate.finishReason;
  const block = response.promptFeedback && response.promptFeedback.blockReason;
  if (finish === 'SAFETY' || finish === 'IMAGE_SAFETY' || finish === 'PROHIBITED_CONTENT' || block) {
    throw new ApiError(422, 'SAFETY_BLOCKED',
      'The AI declined to generate this image (content safety). Try a clear, front-facing photo of an adult.');
  }
  throw new ApiError(502, 'PROVIDER_ERROR', 'The AI did not return an image. Please try again.');
}

async function tryOn({ mode, userImage, garmentImages, productMeta }) {
  assertGeminiCompatible(userImage, 'userPhoto');
  garmentImages.forEach((g, i) => assertGeminiCompatible(g, i === 0 ? 'product image' : `extra garment ${i}`));

  const hasExtras = garmentImages.length > 1;
  const promptText = mode === 'mirror'
    ? prompts.mirror()
    : (hasExtras ? prompts.tryonOutfit({ productName: productMeta.name }) : prompts.tryon({ productName: productMeta.name }));

  const parts = [inlinePart(userImage), ...garmentImages.map(inlinePart), { text: promptText }];

  const response = await client().models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ role: 'user', parts }],
    config: { responseModalities: ['IMAGE', 'TEXT'] },
  });

  return { image: extractImage(response), provider: 'gemini', demoFallback: false };
}

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          closetItemIds: { type: 'array', items: { type: 'string' } },
          reasoning: { type: 'string' },
          missingPiece: { type: 'string' },
        },
        required: ['title', 'closetItemIds', 'reasoning'],
      },
    },
  },
  required: ['suggestions'],
};

async function suggest({ productImage, productMeta, closetItems }) {
  assertGeminiCompatible(productImage, 'product image');
  closetItems.forEach((c, i) => assertGeminiCompatible(c.image, `closet item ${i}`));

  const parts = [
    { text: `Store product image (${productMeta.name || 'unnamed'}):` },
    inlinePart(productImage),
  ];
  closetItems.forEach((item) => {
    parts.push({ text: `Closet item ${item.id}: ${item.label}` });
    parts.push(inlinePart(item.image));
  });
  parts.push({ text: prompts.suggest({ productName: productMeta.name, category: productMeta.category }) });

  const response = await client().models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', responseSchema: SUGGEST_SCHEMA },
  });

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (e) {
    throw new ApiError(502, 'PROVIDER_ERROR', 'The AI returned an unreadable suggestion. Please try again.');
  }
  return { provider: 'gemini', suggestions: parsed.suggestions || [] };
}

module.exports = { name: 'gemini', tryOn, suggest };
