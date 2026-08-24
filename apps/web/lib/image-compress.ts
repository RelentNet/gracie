/**
 * Client-side image compression for uploads.
 *
 * WHY: the office edge proxy (Nginx Proxy Manager / openresty) 500s on any
 * request body over ~10 KB — it can't buffer larger bodies, and we can't change
 * the proxy from the app. So we shrink+re-encode chosen images in the browser to
 * well under that (~6 KB / ≈8 KB base64) BEFORE they're sent. Server routes are
 * unchanged; this only affects what the client puts on the wire.
 *
 * Used by the brand-logo upload (multipart Blob) and the bot-avatar upload
 * (JPEG base64). Both are small display images, so aggressive downscale is fine.
 *
 * ponytail: transparent-PNG logos that stay above budget even at the 48px floor
 * are returned as-is (best effort) — rare for a real logo. Upgrade path if it
 * ever bites: flatten onto white and fall back to JPEG (loses transparency).
 */

export interface CompressResult {
  /** Encoded bytes, ready to drop into FormData. */
  readonly blob: Blob;
  /** `data:<type>;base64,…` of the same bytes, for previews / base64 uploads. */
  readonly dataUrl: string;
  /** MIME of the encoded bytes. */
  readonly type: string;
}

export interface CompressOptions {
  /** Target encoded size in bytes. Default 6000 (≈8 KB base64), under the ~10 KB proxy cap. */
  readonly maxBytes?: number;
  /** Cap on the longest edge, in px. Default 256. Never upscales past the source. */
  readonly maxEdge?: number;
  /** `'jpeg'` forces JPEG (e.g. the avatar). `'auto'` (default) = PNG if the source
   *  has transparency, else JPEG (e.g. the logo). */
  readonly format?: 'jpeg' | 'auto';
}

/** JPEG qualities tried high→low at each dimension step. */
const JPEG_QUALITIES = [0.82, 0.7, 0.58, 0.46, 0.34, 0.24] as const;
const EDGE_FLOOR = 48; // don't shrink below this — a logo/avatar is unreadable smaller

/**
 * Scaled dimensions preserving aspect ratio, capping the longest edge at `maxEdge`.
 * Never upscales. Pure — the one bit worth a unit test.
 */
export function scaledDimensions(
  w: number,
  h: number,
  maxEdge: number,
): { readonly w: number; readonly h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge || longest === 0) return { w, h };
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = (): void => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (): void => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load the image.'));
    };
    img.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(String(reader.result));
    reader.onerror = (): void => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b !== null ? resolve(b) : reject(new Error('Could not encode the image.'))),
      type,
      quality,
    );
  });
}

/** Draw the image into a fresh canvas at w×h. */
function draw(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Canvas not supported.');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

/** True if any pixel is non-opaque (scanned on a small draw — enough to decide format). */
function hasTransparency(img: HTMLImageElement): boolean {
  const { w, h } = scaledDimensions(img.naturalWidth, img.naturalHeight, 64);
  const ctx = draw(img, w, h).getContext('2d');
  if (ctx === null) return false;
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 255) return true;
  return false;
}

/**
 * Downscale + re-encode `file` so the result is under `maxBytes`. Iterates
 * dimensions down (and JPEG quality down) until it fits, or bottoms out at the
 * edge floor and returns the smallest it produced.
 *
 * Passes the file through untouched when it can't or needn't be re-encoded:
 * SVGs (vector — canvas can't emit SVG, and they're near-always tiny already)
 * and anything already under budget.
 */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<CompressResult> {
  const maxBytes = opts.maxBytes ?? 6000;
  const maxEdge = opts.maxEdge ?? 256;

  if (file.type === 'image/svg+xml' || file.size <= maxBytes) {
    return { blob: file, dataUrl: await blobToDataUrl(file), type: file.type };
  }

  const img = await loadImage(file);
  const nat = Math.max(img.naturalWidth, img.naturalHeight);
  if (nat === 0) return { blob: file, dataUrl: await blobToDataUrl(file), type: file.type }; // undecodable dims — best effort

  const type = opts.format === 'jpeg' || !hasTransparency(img) ? 'image/jpeg' : 'image/png';

  let best: Blob | null = null;
  let edge = Math.min(maxEdge, nat);
  for (;;) {
    const { w, h } = scaledDimensions(img.naturalWidth, img.naturalHeight, edge);
    const canvas = draw(img, w, h);
    if (type === 'image/png') {
      best = await canvasToBlob(canvas, 'image/png');
      if (best.size <= maxBytes) break;
    } else {
      let fit = false;
      for (const q of JPEG_QUALITIES) {
        best = await canvasToBlob(canvas, 'image/jpeg', q);
        if (best.size <= maxBytes) {
          fit = true;
          break;
        }
      }
      if (fit) break;
    }
    if (edge <= EDGE_FLOOR) break; // can't shrink further — best is the smallest we got
    edge = Math.max(EDGE_FLOOR, Math.round(edge * 0.72));
  }

  if (best === null) throw new Error('Could not compress the image.');
  return { blob: best, dataUrl: await blobToDataUrl(best), type };
}
