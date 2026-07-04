const { ApiError } = require('./errors');

// SVG is allowed through validation so the placeholder catalog works end to
// end; the Gemini provider can't send SVG and falls back to demo results.
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
const GEMINI_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
// Per-image cap. The full request must stay under Gemini's ~20MB inline-data
// limit; the widget downscales client-side so real payloads are 100-300KB.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// "data:image/jpeg;base64,/9j/4AAQ..." -> { mimeType, data } (data = bare base64)
function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), data: match[2] };
}

function decodedSize(base64) {
  // Close enough for a size cap; avoids buffering the decode.
  return Math.floor(base64.length * 3 / 4);
}

function imageFromDataUrl(dataUrl, label) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new ApiError(400, 'INVALID_IMAGE', `${label} must be a base64 data URL (data:image/...;base64,...)`);
  }
  if (!ALLOWED_MIMES.includes(parsed.mimeType)) {
    throw new ApiError(400, 'INVALID_IMAGE', `${label}: unsupported type ${parsed.mimeType} (use JPEG, PNG or WebP)`);
  }
  if (decodedSize(parsed.data) > MAX_IMAGE_BYTES) {
    throw new ApiError(413, 'IMAGE_TOO_LARGE', `${label} exceeds the 8MB limit`);
  }
  return parsed;
}

// Fetch a product image server-side. Product <img> tags on retailer pages are
// usually cross-origin, which taints canvas and blocks client-side base64
// extraction — so the widget sends us the URL and we fetch it here instead.
async function imageFromUrl(url, label) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ApiError(400, 'INVALID_IMAGE', `${label}: not a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ApiError(400, 'INVALID_IMAGE', `${label}: only http(s) URLs are supported`);
  }

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (err) {
    throw new ApiError(502, 'IMAGE_FETCH_FAILED', `${label}: could not fetch image (${err.name === 'TimeoutError' ? 'timed out' : err.message})`);
  }
  if (!response.ok) {
    throw new ApiError(502, 'IMAGE_FETCH_FAILED', `${label}: image URL returned HTTP ${response.status}`);
  }

  const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIMES.includes(mimeType)) {
    throw new ApiError(400, 'INVALID_IMAGE', `${label}: URL is not a JPEG/PNG/WebP image (got "${mimeType || 'unknown'}")`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ApiError(413, 'IMAGE_TOO_LARGE', `${label} exceeds the 8MB limit`);
  }
  return { mimeType, data: buffer.toString('base64') };
}

// Resolve a product's image from either inline base64 or a URL.
async function resolveProductImage(product, label = 'product image') {
  if (product && typeof product.imageBase64 === 'string') {
    return imageFromDataUrl(product.imageBase64, label);
  }
  if (product && typeof product.imageUrl === 'string') {
    return imageFromUrl(product.imageUrl, label);
  }
  throw new ApiError(400, 'INVALID_REQUEST', 'product.imageUrl or product.imageBase64 is required');
}

function toDataUrl({ mimeType, data }) {
  return `data:${mimeType};base64,${data}`;
}

module.exports = { parseDataUrl, imageFromDataUrl, imageFromUrl, resolveProductImage, toDataUrl, ALLOWED_MIMES, GEMINI_MIMES, MAX_IMAGE_BYTES };
