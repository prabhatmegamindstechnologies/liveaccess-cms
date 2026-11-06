// Every upload is decoded and written again, so nothing but pixels survives: no hidden data, and no file that only looks like an image.
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;
const MAX_WIDTH = 2400;
const ACCEPTED = new Set(["jpeg", "png", "webp"]);

/** The WebP to store, or null if this isn't a usable JPEG, PNG or WebP image. */
export async function processImage(input: Uint8Array) {
  try {
    const image = sharp(input, { limitInputPixels: MAX_PIXELS });
    const { format } = await image.metadata();
    if (!ACCEPTED.has(format)) return null;
    const { data, info } = await image.rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}
