// Provider selection.
// M1 state: a stub provider that returns placeholder images so the widget can
// be built against the real API contract before any AI is wired in.
// Final state (M4/M6): gemini when GEMINI_API_KEY is set and DEMO_MODE!=true,
// otherwise demo (canned results); gemini failures fall back to demo per-request.

const STUB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800">
  <rect width="100%" height="100%" fill="#e8e4de"/>
  <text x="50%" y="48%" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#8a8378">Generated preview</text>
  <text x="50%" y="55%" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#b0a99c">(stub — AI provider not wired yet)</text>
</svg>`;

const stubImage = {
  mimeType: 'image/svg+xml',
  data: Buffer.from(STUB_SVG).toString('base64'),
};

module.exports = {
  name: 'stub',

  async tryOn({ mode, userImage, garmentImages, productMeta }) {
    await new Promise((r) => setTimeout(r, 1200));
    return { image: stubImage, provider: 'stub', demoFallback: false };
  },

  async suggest({ productImage, productMeta, closetItems }) {
    await new Promise((r) => setTimeout(r, 800));
    return {
      provider: 'stub',
      suggestions: [
        {
          title: 'Sample pairing',
          closetItemIds: closetItems.slice(0, 2).map((c) => c.id),
          reasoning: `Stub suggestion: ${productMeta.name || 'this piece'} would pair with your ${closetItems[0].label}.`,
          missingPiece: 'white low-top sneakers',
        },
      ],
    };
  },
};
