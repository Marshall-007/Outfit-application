const express = require('express');
const provider = require('../providers');
const { ApiError } = require('../lib/errors');
const { imageFromDataUrl, resolveProductImage } = require('../lib/images');

const router = express.Router();

// POST /api/suggest
// {
//   product: { id?, name?, category?, imageUrl? | imageBase64? },
//   closet: [ { id, label, imageBase64 }, ... ]   1-8 items
// }
// -> { suggestions: [ { title, closetItemIds, reasoning, missingPiece? } ], provider }
router.post('/', async (req, res) => {
  try {
    const { product, closet } = req.body || {};

    if (!product || typeof product !== 'object') {
      throw new ApiError(400, 'INVALID_REQUEST', 'product is required');
    }
    if (!Array.isArray(closet) || closet.length < 1 || closet.length > 8) {
      throw new ApiError(400, 'INVALID_REQUEST', 'closet must contain 1-8 items');
    }

    const productImage = await resolveProductImage(product);
    const closetItems = closet.map((item, i) => {
      if (!item || !item.id || !item.imageBase64) {
        throw new ApiError(400, 'INVALID_REQUEST', `closet[${i}] needs id and imageBase64`);
      }
      return {
        id: String(item.id),
        label: String(item.label || 'clothing item'),
        image: imageFromDataUrl(item.imageBase64, `closet[${i}]`),
      };
    });

    const result = await provider.suggest({
      productImage,
      productMeta: { id: product.id, name: product.name, category: product.category },
      closetItems,
    });

    res.json({ suggestions: result.suggestions, provider: result.provider });
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('suggest error:', err);
    res.status(502).json({ error: { code: 'PROVIDER_ERROR', message: 'Suggestion generation failed. Please try again.' } });
  }
});

module.exports = router;
