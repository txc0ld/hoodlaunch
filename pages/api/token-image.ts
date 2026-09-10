import { requirePro, takeQuota } from '../../src/server/public-services';
import { fail, readBody, safeHandler, writeGuard } from '../../src/server/public-security';
import { IMAGE_LIMIT, sanitizeImage, uploadPublicImage } from '../../src/server/public-upload';
export const config = { api: { bodyParser: false }, maxDuration: 60 };
export default safeHandler(async (req, res) => {
  writeGuard(req);
  const id = await requirePro(req);
  if (!process.env.PINATA_JWT) fail(503, 'UPLOAD_SETUP', 'Managed image uploads are not configured. Use an existing image URI.');
  const mime = req.headers['content-type'] || '';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) fail(415, 'IMAGE', 'Use PNG, JPEG or WebP.');
  // Durable admission before decoding or provider costs; failures consume a slot deliberately.
  await takeQuota(`upload:${id}`, 50, 86400);
  await takeQuota('upload-global', 1000, 86400);
  const image = await sanitizeImage(await readBody(req, IMAGE_LIMIT), mime);
  res.json(await uploadPublicImage(image));
});
