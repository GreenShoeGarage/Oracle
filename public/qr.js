import qrcode from "./vendor/qrcode-generator-2.0.4.js";
import jsQR from "./vendor/jsqr-1.4.0.js";

const BADGE_CODE = /^[A-HJ-NP-Z2-9]{20}$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Accept a typed badge code or an ORACLE badge link; never navigate scanned URLs. */
export function parseBadgeInput(value, origin) {
  if (typeof value !== "string" || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Enter an ORACLE badge code or badge link.");
  const input = value.trim();
  const code = input.toUpperCase().replace(/[ -]/g, "");
  if (BADGE_CODE.test(code)) return code;
  try {
    const expected = new URL(origin);
    const url = new URL(input);
    if (!["https:", "http:"].includes(expected.protocol) || url.origin !== expected.origin ||
      url.username || url.password || url.pathname !== "/" || url.search) throw new Error();
    const match = /^#badge\/([A-HJ-NP-Z2-9]{20})$/i.exec(url.hash);
    if (match) return match[1].toUpperCase();
  } catch { /* All unsafe and malformed input shares one user-facing error. */ }
  throw new Error("Use a badge code or a badge link from this ORACLE site.");
}

/** Pixel-perfect black-on-white QR, with the required four-module quiet zone. */
export function badgeQrPixels(text, size = 256) {
  if (typeof text !== "string" || !/^[\x20-\x7e]{1,512}$/.test(text)) throw new Error("The badge link is invalid.");
  if (!Number.isFinite(size) || size < 144 || size > 1024) throw new Error("QR size must be between 144 and 1024 pixels.");
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const count = qr.getModuleCount(), quiet = 4;
  const scale = Math.max(2, Math.floor(size / (count + quiet * 2)));
  const width = (count + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (!qr.isDark(row, column)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const offset = (((row + quiet) * scale + y) * width + (column + quiet) * scale + x) * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = 0;
        }
      }
    }
  }
  return { data, width, height: width };
}

export function renderBadgeQR(container, text, size = 256) {
  const { data, width, height } = badgeQrPixels(text, size);
  const canvas = (container.ownerDocument || document).createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "ORACLE character badge QR code");
  canvas.style.maxWidth = "100%";
  canvas.style.height = "auto";
  const context = canvas.getContext("2d");
  if (!context) throw new Error("QR drawing is unavailable. Use the badge code instead.");
  const pixels = context.createImageData(width, height);
  pixels.data.set(data);
  context.putImageData(pixels, 0, 0);
  container.replaceChildren(canvas);
  return canvas;
}

function decodeFrame(source, canvas, maxSide) {
  const sourceWidth = source.videoWidth || source.naturalWidth;
  const sourceHeight = source.videoHeight || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) return null;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Image scanning is unavailable. Enter the badge code instead.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  return jsQR(pixels.data, width, height, { inversionAttempts: "attemptBoth" })?.data || null;
}

async function validateImage(file) {
  if (!file || typeof file.slice !== "function" || !Number.isSafeInteger(file.size) || file.size < 12 ||
    file.size > MAX_IMAGE_BYTES || !IMAGE_TYPES.has(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image no larger than 8 MB.");
  }
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  const webp = String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  if (!(file.type === "image/png" && png || file.type === "image/jpeg" && jpeg || file.type === "image/webp" && webp)) {
    throw new Error("This file is not a supported image. Choose a PNG, JPEG, or WebP photo.");
  }
}

/** Decode an uploaded image locally. The image and QR content are never uploaded. */
export async function scanImage(file) {
  await validateImage(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("This image could not be opened. Choose a PNG, JPEG, or WebP photo."));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32_000_000) {
      throw new Error("Choose an image under 32 megapixels, cropped around the QR code.");
    }
    const canvas = document.createElement("canvas");
    const result = decodeFrame(image, canvas, 1600);
    if (!result) throw new Error("No QR code found. Try a sharper photo, crop around the code, or enter the badge code.");
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cameraError(error) {
  if (["NotAllowedError", "SecurityError"].includes(error?.name)) return new Error("Camera access was denied. Allow it in your browser, upload a photo, or enter the badge code.");
  if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) return new Error("No camera was found. Upload a photo or enter the badge code.");
  if (["NotReadableError", "TrackStartError"].includes(error?.name)) return new Error("The camera is busy. Close other camera apps, upload a photo, or enter the badge code.");
  return new Error("The camera could not start. Upload a photo or enter the badge code.");
}

/** Invoke from a user gesture. AbortSignal also closes cameras granted after a modal closes. */
export async function startScanner(video, onResult, onError, { signal } = {}) {
  let active = true, stream = null, frame = 0, lastRead = -Infinity;
  const stop = () => {
    active = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    document.removeEventListener("visibilitychange", onVisibility);
    signal?.removeEventListener("abort", stop);
  };
  const onVisibility = () => { if (document.hidden) stop(); };
  if (signal?.aborted) { stop(); return stop; }
  signal?.addEventListener("abort", stop, { once: true });
  document.addEventListener("visibilitychange", onVisibility);
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    if (!active) { stop(); return stop; }
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.srcObject = stream;
    await video.play();
    if (!active) { stop(); return stop; }
    const canvas = document.createElement("canvas");
    const read = (time) => {
      if (!active) return;
      if (video.readyState >= 2 && time - lastRead >= 200) {
        lastRead = time;
        let result;
        try { result = decodeFrame(video, canvas, 960); }
        catch (error) { stop(); onError(error); return; }
        if (result) { stop(); onResult(result); return; }
      }
      frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
  } catch (error) {
    const shouldReport = active;
    stop();
    if (shouldReport) onError(cameraError(error));
  }
  return stop;
}
