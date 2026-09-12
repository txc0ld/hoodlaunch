import sharp from 'sharp';
import { isValidCid } from './public-cid';
import { fail, PublicError } from './public-security';
export const IMAGE_LIMIT = 4 * 1024 * 1024;
export const NORMALIZED_IMAGE_LIMIT = 1024 * 1024;
export async function sanitizeImage(bytes: Buffer, mime: string) {
  const formats: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
  if (!formats[mime] || !bytes.length || bytes.length > IMAGE_LIMIT) fail(415, 'IMAGE', 'Choose a PNG, JPEG or WebP image up to 4 MB.');
  try {
    const pipeline = sharp(bytes, { limitInputPixels: 16000000, animated: false, failOn: 'warning' }).timeout({ seconds: 5 });
    const metadata = await pipeline.metadata();
    if (metadata.format !== formats[mime] || (metadata.pages || 1) !== 1) fail(415, 'IMAGE', 'Use a still PNG, JPEG or WebP image.');
    const output = await pipeline.rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    if (output.length > NORMALIZED_IMAGE_LIMIT) fail(413, 'IMAGE_OUTPUT', 'The processed image is over 1 MB. Choose a simpler or smaller image.');
    return output;
  } catch (error) {
    if (error instanceof PublicError) throw error;
    return fail(415, 'IMAGE', 'The image could not be decoded safely.');
  }
}
export async function uploadPublicImage(bytes: Buffer) {
  if (!process.env.PINATA_JWT) fail(503, 'UPLOAD_SETUP', 'Managed image uploads are not configured. Use an existing image URI.');
  if (!bytes.length || bytes.length > NORMALIZED_IMAGE_LIMIT) fail(413, 'IMAGE_OUTPUT', 'The processed image is over 1 MB. Choose a simpler or smaller image.');
  const form = new FormData(); form.append('network', 'public'); form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/webp' }), 'token.webp');
  let response: Response;
  try {
    response = await fetch('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body: form, signal: AbortSignal.timeout(15000), redirect: 'error' });
  } catch { return fail(502, 'UPLOAD_FAILED', 'Image storage is unavailable. Try again later.'); }
  if (!response.ok) fail(502, 'UPLOAD_FAILED', 'Image storage is unavailable. Try again later.');
  const reader = response.body?.getReader();
  if (!reader) fail(502, 'UPLOAD_FAILED', 'Invalid image storage response.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 32768) {
        try { await reader.cancel(); } catch { /* The bounded rejection remains authoritative. */ }
        fail(502, 'UPLOAD_FAILED', 'Invalid image storage response.');
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof PublicError) throw error;
    return fail(502, 'UPLOAD_FAILED', 'Image storage is unavailable. Try again later.');
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let result: { data?: { cid?: string } };
  try { result = JSON.parse(text); } catch { return fail(502, 'UPLOAD_FAILED', 'Invalid image storage response.'); }
  const cid = result.data?.cid;
  if (!isValidCid(cid)) fail(502, 'UPLOAD_FAILED', 'Invalid image storage response.');
  return { uri: `ipfs://${cid}`, cid };
}
