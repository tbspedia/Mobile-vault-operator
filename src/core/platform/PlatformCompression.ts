/**
 * PlatformCompression -- Cross-platform compression and decompression utilities.
 *
 * Allows decompressing gzip-compressed assets (like the bundled sql.js WASM)
 * in both desktop Electron and mobile WebViews without requiring Node.js `node:zlib`
 * or `Buffer`.
 */

import { Platform } from 'obsidian';

/**
 * Decode base64 string to Uint8Array without Node.js Buffer.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
        const buf = Buffer.from(base64, 'base64');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * Encode Uint8Array to base64 string without Node.js Buffer.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Decompress a gzip-compressed Uint8Array.
 * Uses web-standard DecompressionStream if available (iOS Safari 16.4+, Android WebView, modern Node),
 * and falls back to Node.js `node:zlib` on Desktop.
 */
export async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
    // 1. Preferred modern web standard: DecompressionStream
    if (typeof DecompressionStream !== 'undefined') {
        try {
            const ds = new DecompressionStream('gzip');
            const writer = ds.writable.getWriter();
            void writer.write(data);
            void writer.close();

            const response = new Response(ds.readable);
            const arrayBuffer = await response.arrayBuffer();
            return new Uint8Array(arrayBuffer);
        } catch (e) {
            console.warn('[PlatformCompression] DecompressionStream failed, attempting fallback:', e);
        }
    }

    // 2. Desktop Electron fallback: node:zlib
    if (Platform.isDesktopApp) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const zlib = require('node:zlib') as typeof import('node:zlib');
            const unzipped = zlib.gunzipSync(data);
            return new Uint8Array(unzipped.buffer, unzipped.byteOffset, unzipped.byteLength);
        } catch (e) {
            console.error('[PlatformCompression] Desktop zlib fallback failed:', e);
            throw e;
        }
    }

    throw new Error('Gzip decompression is not supported in this runtime environment (DecompressionStream missing).');
}

/**
 * Compress a Uint8Array using gzip.
 */
export async function compressGzip(data: Uint8Array): Promise<Uint8Array> {
    if (typeof CompressionStream !== 'undefined') {
        const cs = new CompressionStream('gzip');
        const writer = cs.writable.getWriter();
        void writer.write(data);
        void writer.close();

        const response = new Response(cs.readable);
        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }

    if (Platform.isDesktopApp) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const zlib = require('node:zlib') as typeof import('node:zlib');
        const zipped = zlib.gzipSync(data);
        return new Uint8Array(zipped.buffer, zipped.byteOffset, zipped.byteLength);
    }

    throw new Error('Gzip compression is not supported in this runtime environment (CompressionStream missing).');
}
