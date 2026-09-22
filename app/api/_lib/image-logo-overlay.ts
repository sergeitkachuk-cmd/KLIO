import sharp from "sharp";
import type { ImageInput, ImageOutputFormat, LogoPosition } from "./image-generation";

// Composite the real logo only inside its bounds. Its alpha must never become
// the photograph's mask; pixels outside the mark retain their original alpha.
export async function overlayImageLogo(image: Uint8Array, logo: ImageInput, position: LogoPosition = "bottom-right", outputFormat: ImageOutputFormat = "png") {
  if (logo.bytes.byteLength > 8 * 1024 * 1024) throw new Error("Файл логотипа слишком большой.");
  const base = await sharp(Buffer.from(image), { limitInputPixels: 40_000_000 }).rotate().png().toBuffer({ resolveWithObject: true });
  const { width, height } = base.info;
  const padding = Math.max(1, Math.round(Math.min(width, height) * 0.035));
  const mark = await sharp(Buffer.from(logo.bytes), { limitInputPixels: 40_000_000 }).rotate()
    .resize({ width: Math.max(1, Math.round(width * 0.2)), height: Math.max(1, Math.round(height * 0.16)), fit: "inside" })
    .png().toBuffer({ resolveWithObject: true });
  const left = position.endsWith("left") ? padding : width - padding - mark.info.width;
  const top = position.startsWith("top") ? padding : height - padding - mark.info.height;
  const composed = sharp(base.data).composite([{ input: mark.data, left: Math.max(0, left), top: Math.max(0, top), blend: "over" }]);
  const bytes = outputFormat === "jpeg" ? await composed.jpeg({ quality: 95 }).toBuffer()
    : outputFormat === "webp" ? await composed.webp({ lossless: true }).toBuffer() : await composed.png().toBuffer();
  return { bytes: new Uint8Array(bytes), contentType: `image/${outputFormat}` };
}
