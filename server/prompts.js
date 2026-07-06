// All model prompts live here so they're easy to tune in one place.

// Image order the provider sends: [userPhoto, garment, ...extraGarments], then text.
const tryon = ({ productName }) =>
  `You are a virtual try-on engine. The first image is a photo of a person. The second image is a garment` +
  (productName ? ` (${productName})` : '') + `.
Dress the person from the first image in that garment. Keep the person's face, hairstyle, skin tone, body shape, pose, and the photo's background exactly the same — change only their clothing to the garment shown. Render the garment with realistic fit, fabric drape, folds, and lighting consistent with the original photo. Output a single photorealistic image.`;

const tryonOutfit = ({ productName }) =>
  tryon({ productName }) +
  `\nThe remaining images are additional garments/accessories the person already owns — incorporate them to complete a cohesive outfit alongside the main garment.`;

const mirror = () =>
  `The first image is a photo of a customer's face. The second image is a fashion e-commerce product photo of a model wearing clothing.
Make it look like the CUSTOMER from the first image is the person wearing these exact clothes. Specifically:
- Replace the model's face with the customer's face, matching their facial features, hair, and expression naturally to the model's head position and camera angle.
- Adjust ALL visible skin on the model — face, neck, hands, arms, legs — to match the customer's skin tone, so the result is consistent and believable.
- Keep the clothing (every garment, colour, pattern, logo and fold), the pose, the body proportions, the framing, the lighting, and the background EXACTLY the same as the second image. Do not restyle or re-drape the clothes.
Blend the swap seamlessly with realistic lighting and shadows. Output one photorealistic image at the same framing as the second image.`;

// Instruction appended after the product image + labelled closet images.
const suggest = ({ productName, category }) =>
  `A shopper is looking at this store product: "${productName || 'the item shown'}"` +
  (category ? ` (category: ${category})` : '') + `.
The remaining images are clothing items the shopper already owns; each is labelled with an id and a short description.
Propose 2 or 3 complete outfit combinations that pair the store product with the shopper's own items. For each outfit: give it a short evocative title, list the ids of the closet items it uses, explain in 1-2 sentences why the combination works (color, style, occasion), and optionally name one additional piece the shopper doesn't yet own that would complete the look ("missingPiece"). Be specific and reference the actual items.`;

module.exports = { tryon, tryonOutfit, mirror, suggest };
