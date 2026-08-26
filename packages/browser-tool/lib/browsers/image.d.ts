export interface ImageResizeOptions {
    maxWidth?: number;
    maxHeight?: number;
    /** Smallest allowed edge length (px). Inputs below this are scaled up. */
    minDimension?: number;
    maxBytes?: number;
    jpegQuality?: number;
    excludeWebP?: boolean;
}
export interface ResizedImage {
    buffer: Uint8Array;
    mimeType: string;
    originalWidth: number;
    originalHeight: number;
    width: number;
    height: number;
    wasResized: boolean;
    decodeFailed?: boolean;
    get data(): string;
}
/**
 * Resize and recompress an image to fit within the specified max dimensions and
 * file size: metadata probe → resize → PNG/JPEG(+WebP) smallest → quality
 * ladder → dimension × quality ladder.
 */
export declare function resizeImage(img: {
    data: string;
    mimeType: string;
}, options?: ImageResizeOptions): Promise<ResizedImage>;
/** Read-only reference count helper for tests. */
export declare function _sharpAvailableForTest(): boolean | undefined;
