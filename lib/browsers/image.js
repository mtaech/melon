// 500KB target — aggressive compression once images are downsized to 1568px
// (Anthropic's internal recommended limit).
const DEFAULT_MAX_BYTES = 500 * 1024;
// Smallest edge length (px) vision backends reliably accept.
const DEFAULT_MIN_DIMENSION = 200;
const DEFAULT_OPTIONS = {
    maxWidth: 1568,
    maxHeight: 1568,
    maxBytes: DEFAULT_MAX_BYTES,
    jpegQuality: 80,
    minDimension: DEFAULT_MIN_DIMENSION,
};
function readUint16BE(buffer, offset) {
    return (buffer[offset] << 8) | buffer[offset + 1];
}
function readUint32BE(buffer, offset) {
    return ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0;
}
function readPngHeaderDimensions(buffer) {
    if (buffer.length < 24)
        return undefined;
    if (buffer[0] !== 0x89 ||
        buffer[1] !== 0x50 ||
        buffer[2] !== 0x4e ||
        buffer[3] !== 0x47 ||
        buffer[4] !== 0x0d ||
        buffer[5] !== 0x0a ||
        buffer[6] !== 0x1a ||
        buffer[7] !== 0x0a) {
        return undefined;
    }
    if (readUint32BE(buffer, 8) !== 13)
        return undefined;
    if (buffer[12] !== 0x49 || buffer[13] !== 0x48 || buffer[14] !== 0x44 || buffer[15] !== 0x52)
        return undefined;
    const width = readUint32BE(buffer, 16);
    const height = readUint32BE(buffer, 20);
    if (width === 0 || height === 0)
        return undefined;
    return { width, height, mimeType: "image/png" };
}
function isJpegStartOfFrame(marker) {
    return ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf));
}
function readJpegHeaderDimensions(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8)
        return undefined;
    let offset = 2;
    while (offset + 3 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset++;
            continue;
        }
        while (offset < buffer.length && buffer[offset] === 0xff)
            offset++;
        if (offset >= buffer.length)
            return undefined;
        const marker = buffer[offset++];
        if (marker === 0xd9 || marker === 0xda)
            return undefined;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
            continue;
        if (offset + 1 >= buffer.length)
            return undefined;
        const segmentLength = readUint16BE(buffer, offset);
        if (segmentLength < 2)
            return undefined;
        if (isJpegStartOfFrame(marker)) {
            if (offset + 7 >= buffer.length)
                return undefined;
            const height = readUint16BE(buffer, offset + 3);
            const width = readUint16BE(buffer, offset + 5);
            if (width === 0 || height === 0)
                return undefined;
            return { width, height, mimeType: "image/jpeg" };
        }
        offset += segmentLength;
    }
    return undefined;
}
function readImageHeaderDimensions(buffer) {
    return readPngHeaderDimensions(buffer) ?? readJpegHeaderDimensions(buffer);
}
function isWebPExcluded() {
    const raw = process.env.DSH_BROWSER_NO_WEBP;
    if (raw === undefined)
        return false;
    const v = raw.toLowerCase();
    return v === "1" || v === "true";
}
function pickSmallest(...candidates) {
    return candidates.reduce((best, c) => (c.buffer.length < best.buffer.length ? c : best));
}
let sharpAvailable;
async function loadSharp() {
    if (sharpAvailable === false)
        return null;
    try {
        const mod = (await import("sharp"));
        const factory = mod.default ?? mod;
        sharpAvailable = true;
        return factory;
    }
    catch {
        sharpAvailable = false;
        logFallback();
        return null;
    }
}
function logFallback() {
    // No logger import here to keep the module dependency-free; safeJsonStringify
    // is trivially available.
    console.error("[browser-tool:info] sharp unavailable; screenshots pass through un-resized");
}
/**
 * Resize and recompress an image to fit within the specified max dimensions and
 * file size: metadata probe → resize → PNG/JPEG(+WebP) smallest → quality
 * ladder → dimension × quality ladder.
 */
export async function resizeImage(img, options) {
    const excludeWebP = options?.excludeWebP ?? isWebPExcluded();
    const opts = { ...DEFAULT_OPTIONS, ...options, excludeWebP };
    const inputBuffer = Buffer.from(img.data, "base64");
    // Header-probe dimensions for the fast path (no decode needed).
    const probed = readImageHeaderDimensions(new Uint8Array(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.byteLength));
    if (!probed) {
        // Unknown format: pass through untouched.
        return passthrough(inputBuffer, img.mimeType, img.data, true);
    }
    const originalWidth = probed.width;
    const originalHeight = probed.height;
    const sourceMime = probed.mimeType;
    const originalSize = inputBuffer.length;
    const comfortableSize = opts.maxBytes / 4;
    const minDimension = Math.min(opts.minDimension, opts.maxWidth, opts.maxHeight);
    if (originalWidth >= minDimension &&
        originalHeight >= minDimension &&
        originalWidth <= opts.maxWidth &&
        originalHeight <= opts.maxHeight &&
        originalSize <= comfortableSize &&
        !(opts.excludeWebP && sourceMime === "image/webp")) {
        return {
            buffer: inputBuffer,
            mimeType: sourceMime,
            originalWidth,
            originalHeight,
            width: originalWidth,
            height: originalHeight,
            wasResized: false,
            get data() {
                return img.data;
            },
        };
    }
    let targetWidth = originalWidth;
    let targetHeight = originalHeight;
    if (targetWidth > opts.maxWidth) {
        targetHeight = Math.round((targetHeight * opts.maxWidth) / targetWidth);
        targetWidth = opts.maxWidth;
    }
    if (targetHeight > opts.maxHeight) {
        targetWidth = Math.round((targetWidth * opts.maxHeight) / targetHeight);
        targetHeight = opts.maxHeight;
    }
    if (targetWidth < minDimension || targetHeight < minDimension) {
        const shortEdge = Math.min(targetWidth, targetHeight);
        const upscale = Math.min(minDimension / shortEdge, opts.maxWidth / targetWidth, opts.maxHeight / targetHeight);
        if (upscale > 1) {
            targetWidth = Math.round(targetWidth * upscale);
            targetHeight = Math.round(targetHeight * upscale);
        }
        targetWidth = Math.min(opts.maxWidth, Math.max(minDimension, targetWidth));
        targetHeight = Math.min(opts.maxHeight, Math.max(minDimension, targetHeight));
    }
    const sharp = await loadSharp();
    if (!sharp) {
        // No encoder available: hand back the original bytes (flagged).
        return passthrough(inputBuffer, sourceMime, img.data, true);
    }
    const encode = async (width, height, quality, fmt) => {
        try {
            const pipe = sharp(inputBuffer, { failOn: "none" })
                .resize(width, height, { fit: "fill" })
                .removeAlpha();
            let out;
            if (fmt === "png")
                out = await pipe.png({ palette: true, quality }).toBuffer();
            else if (fmt === "jpeg")
                out = await pipe.jpeg({ quality, mozjpeg: true }).toBuffer();
            else
                out = await pipe.webp({ quality }).toBuffer();
            return { buffer: out, mimeType: `image/${fmt}` };
        }
        catch {
            return null;
        }
    };
    const candidates = [];
    const formats = opts.excludeWebP ? ["png", "jpeg"] : ["png", "jpeg", "webp"];
    for (const fmt of formats) {
        const enc = await encode(targetWidth, targetHeight, opts.jpegQuality, fmt);
        if (enc)
            candidates.push(enc);
    }
    let best = pickSmallest(...(candidates.length > 0 ? candidates : [{ buffer: inputBuffer, mimeType: sourceMime }]));
    // Quality ladder then dimension ladder while still over budget.
    if (best.buffer.length > opts.maxBytes) {
        for (const quality of [opts.jpegQuality - 10, opts.jpegQuality - 20, opts.jpegQuality - 30]) {
            if (quality <= 10)
                break;
            const enc = await encode(targetWidth, targetHeight, Math.max(10, quality), "jpeg");
            if (enc && enc.buffer.length < best.buffer.length)
                best = enc;
        }
    }
    if (best.buffer.length > opts.maxBytes && targetWidth > 480) {
        const scale = Math.max(0.5, Math.sqrt(opts.maxBytes / best.buffer.length));
        const w = Math.max(480, Math.round(targetWidth * scale));
        const h = Math.max(320, Math.round(targetHeight * scale));
        for (const quality of [opts.jpegQuality, opts.jpegQuality - 20]) {
            const enc = await encode(w, h, quality, "jpeg");
            if (enc && enc.buffer.length < best.buffer.length)
                best = enc;
        }
    }
    return {
        buffer: best.buffer,
        mimeType: best.mimeType,
        originalWidth,
        originalHeight,
        width: targetWidth,
        height: targetHeight,
        wasResized: true,
        get data() {
            return Uint8ArrayToBase64(best.buffer);
        },
    };
}
function passthrough(buffer, mimeType, originalData, decodeFailed) {
    return {
        buffer,
        mimeType,
        originalWidth: 0,
        originalHeight: 0,
        width: 0,
        height: 0,
        wasResized: false,
        decodeFailed,
        get data() {
            return originalData;
        },
    };
}
function Uint8ArrayToBase64(buffer) {
    return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString("base64");
}
/** Read-only reference count helper for tests. */
export function _sharpAvailableForTest() {
    return sharpAvailable;
}
