import { describe, it, expect } from 'vitest';
import { PlatformPath, base64ToUint8Array, uint8ArrayToBase64, decompressGzip, compressGzip } from '../index';
import { sha256Hex } from '../../utils/sha256';

describe('PlatformPath (Mobile POSIX Path Abstraction)', () => {
    it('normalizes paths to forward slashes', () => {
        expect(PlatformPath.normalize('folder\\subfolder\\file.md')).toBe('folder/subfolder/file.md');
        expect(PlatformPath.normalize('/a//b///c')).toBe('a/b/c');
    });

    it('joins paths correctly', () => {
        expect(PlatformPath.join('vault', 'folder', 'note.md')).toBe('vault/folder/note.md');
        expect(PlatformPath.join('/root/', '/child/', 'file.txt')).toBe('/root/child/file.txt');
    });

    it('extracts dirname, basename, and extname', () => {
        const filePath = 'folder/subfolder/document.note.md';
        expect(PlatformPath.dirname(filePath)).toBe('folder/subfolder');
        expect(PlatformPath.basename(filePath)).toBe('document.note.md');
        expect(PlatformPath.basename(filePath, '.md')).toBe('document.note');
        expect(PlatformPath.extname(filePath)).toBe('.md');
        expect(PlatformPath.dirname('root_file.md')).toBe('.');
    });
});

describe('PlatformCompression (Mobile Gzip / Base64)', () => {
    it('converts between Uint8Array and Base64', () => {
        const text = 'Hello, Vault Operator Mobile!';
        const bytes = new TextEncoder().encode(text);
        const base64 = uint8ArrayToBase64(bytes);
        const restoredBytes = base64ToUint8Array(base64);
        const restoredText = new TextDecoder().decode(restoredBytes);

        expect(restoredText).toBe(text);
    });

    it('compresses and decompresses gzip payloads', async () => {
        const sourceText = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
        const sourceBytes = new TextEncoder().encode(sourceText);

        const compressed = await compressGzip(sourceBytes);
        expect(compressed.byteLength).toBeLessThan(sourceBytes.byteLength);

        const decompressed = await decompressGzip(compressed);
        const restoredText = new TextDecoder().decode(decompressed);
        expect(restoredText).toBe(sourceText);
    });
});

describe('Pure-JS SHA-256 Fallback', () => {
    it('computes correct NIST standard SHA-256 hashes', () => {
        // Empty string
        expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

        // Simple sentence
        expect(sha256Hex('Hello World')).toBe('a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e');

        // Long text
        const longStr = 'Obsidian Mobile SQLite KnowledgeDB Test String'.repeat(20);
        const hash = sha256Hex(longStr);
        expect(hash).toHaveLength(64);
        expect(typeof hash).toBe('string');
    });
});

describe('Mobile Bundle Evaluation Simulation', () => {
    it('evaluates main.js without missing Node module exceptions', async () => {
        const fs = await import('fs');
        const vm = await import('vm');
        if (!fs.existsSync('main.js')) return;
        const code = fs.readFileSync('main.js', 'utf8');

        const mockObsidian = new Proxy({
            Plugin: class { constructor() {} },
            Platform: { isDesktopApp: false, isMobile: true, isIos: false, isAndroidApp: true },
            normalizePath: (p: string) => (p || '').replace(/\\/g, '/'),
            Notice: class {},
            requestUrl: async () => ({ status: 200, json: async () => ({}) })
        }, {
            get(target, prop) {
                if (prop in target) return (target as Record<string, unknown>)[prop as string];
                return class {};
            }
        });

        const moduleObj = { exports: {} as Record<string, unknown> };
        const sandbox: Record<string, unknown> = {
            window: {},
            document: {
                createElement: () => ({ addEventListener: () => {}, setAttribute: () => {}, style: {} }),
                body: { appendChild: () => {}, createEl: () => ({}) }
            },
            module: moduleObj,
            exports: moduleObj.exports,
            navigator: { userAgent: 'Android' },
            console,
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            TextEncoder,
            TextDecoder,
            ReadableStream,
            WritableStream,
            TransformStream,
            Headers,
            Request,
            Response,
            fetch,
            atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
            btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
            require: (id: string) => {
                if (id === 'obsidian') return mockObsidian;
                if (id.startsWith('@codemirror/') || id.startsWith('@lezer/')) return new Proxy({}, { get: () => class {} });
                throw new Error(`Cannot find module '${id}' (simulated mobile WebView)`);
            }
        };
        sandbox.window = sandbox;
        sandbox.global = sandbox;
        sandbox.globalThis = sandbox;

        expect(() => {
            const script = new vm.Script(code, { filename: 'main.js' });
            const context = vm.createContext(sandbox);
            script.runInContext(context);
        }).not.toThrow();

        expect(typeof moduleObj.exports).toBe('object');
    });
});

