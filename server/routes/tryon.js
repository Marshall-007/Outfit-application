const express = require('express');
const provider = require('../providers');
const { ApiError } = require('../lib/errors');
const { imageFromDataUrl, resolveProductImage, toDataUrl } = require('../lib/images');

const router = express.Router();

// POST /api/tryon
// {
//   mode: "tryon" | "mirror",            (default "tryon")
//   userPhoto: dataURL,                  required
//   product: { id?, name?, imageUrl? | imageBase64? },
//   extraGarments: [dataURL, ...]        optional, max 2 (closet items for a full outfit)
// }
// -> { image: dataURL, provider, demoFallback, latencyMs }
router.post('/', async (req, res) => {
  const started = Date.now();
  try {
    const { mode = 'tryon', userPhoto, product, extraGarments = [] } = req.body || {};

    if (!['tryon', 'mirror'].includes(mode)) {
      throw new ApiError(400, 'INVALID_REQUEST', 'mode must be "tryon" or "mirror"');
    }
    if (!userPhoto) {
      throw new ApiError(400, 'INVALID_REQUEST', 'userPhoto is required');
    }
    if (!product || typeof product !== 'object') {
      throw new ApiError(400, 'INVALID_REQUEST', 'product is required');
    }
    if (!Array.isArray(extraGarments) || extraGarments.length > 2) {
      throw new ApiError(400, 'INVALID_REQUEST', 'extraGarments must be an array of at most 2 images');
    }

    const userImage = imageFromDataUrl(userPhoto, 'userPhoto');
    const productImage = await resolveProductImage(product);
    const extras = extraGarments.map((g, i) => imageFromDataUrl(g, `extraGarments[${i}]`));

    const result = await provider.tryOn({
      mode,
      userImage,
      garmentImages: [productImage, ...extras],
      productMeta: { id: product.id, name: product.name },
    });

    res.json({
      image: toDataUrl(result.image),
      provider: result.provider,
      demoFallback: !!result.demoFallback,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    sendError(res, err);
  }
});

function sendError(res, err) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  console.error('tryon error:', err);
  res.status(502).json({ error: { code: 'PROVIDER_ERROR', message: 'Image generation failed. Please try again.' } });
}

module.exports = router;
