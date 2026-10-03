// Receipt photo compression in the browser (PLAN §5): the same compressed image goes to the AI and to storage.

const MAX_SIDE = 2000;
export const TARGET_BYTES = 300 * 1024;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Grayscale in place (ctx.filter isn't available on older Safari). Receipts are black on white: color adds bytes only. */
function grayscale(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Downscales (long side ≤ 2000 px), converts to grayscale and encodes as WebP (JPEG where the browser can't encode
 * WebP, e.g. Safari), stepping quality down until ≤ 300 KB. EXIF orientation is applied by createImageBitmap.
 */
export async function compressReceiptPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  let w = Math.round(bitmap.width * scale);
  let h = Math.round(bitmap.height * scale);

  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    grayscale(ctx, w, h);

    for (const quality of [0.72, 0.6, 0.5]) {
      let blob = await toBlob(canvas, "image/webp", quality);
      if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
      if (blob && blob.size <= TARGET_BYTES) {
        bitmap.close();
        return blob;
      }
    }
    // Still too big (very detailed photo): shrink and retry.
    w = Math.round(w * 0.8);
    h = Math.round(h * 0.8);
  }
  bitmap.close();
  throw new Error("Impossibile comprimere la foto: prova a inquadrare solo lo scontrino");
}
