/**
 * PlatformPath -- Pure cross-platform path utilities for Obsidian.
 *
 * Obsidian vaults always use forward slashes ('/') regardless of OS.
 * On desktop Electron, this utility delegates to Node.js `path` for absolute OS paths
 * when needed, but safely falls back to standard POSIX-compliant string manipulation
 * in mobile WebViews where Node.js is unavailable.
 */

import { Platform, normalizePath } from 'obsidian';

let nodePath: typeof import('path') | null = null;

function getNodePath(): typeof import('path') | null {
    if (nodePath) return nodePath;
    if (Platform.isDesktopApp) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            nodePath = require('path') as typeof import('path');
        } catch {
            nodePath = null;
        }
    }
    return nodePath;
}

export const PlatformPath = {
    /**
     * Join path segments with standard forward slashes.
     */
    join(...parts: string[]): string {
        const filtered = parts.filter(p => typeof p === 'string' && p.length > 0);
        if (filtered.length === 0) return '';
        
        const raw = filtered.join('/').replace(/\\/g, '/');
        // Collapse consecutive slashes, except leading double slash (UNC/protocol)
        const isAbsolute = raw.startsWith('/');
        const segments = raw.split('/').filter(s => s.length > 0 && s !== '.');
        
        const resolved: string[] = [];
        for (const seg of segments) {
            if (seg === '..') {
                if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
                    resolved.pop();
                } else if (!isAbsolute) {
                    resolved.push('..');
                }
            } else {
                resolved.push(seg);
            }
        }
        
        const res = (isAbsolute ? '/' : '') + resolved.join('/');
        return res.length === 0 ? (isAbsolute ? '/' : '.') : res;
    },

    /**
     * Return directory name of a path.
     */
    dirname(p: string): string {
        const np = p.replace(/\\/g, '/').replace(/\/+$/, '');
        const idx = np.lastIndexOf('/');
        if (idx === -1) return '.';
        if (idx === 0) return '/';
        return np.slice(0, idx);
    },

    /**
     * Return basename of a path with optional extension stripping.
     */
    basename(p: string, ext?: string): string {
        const np = p.replace(/\\/g, '/').replace(/\/+$/, '');
        const idx = np.lastIndexOf('/');
        let base = idx === -1 ? np : np.slice(idx + 1);
        if (ext && base.endsWith(ext) && base !== ext) {
            base = base.slice(0, -ext.length);
        }
        return base;
    },

    /**
     * Return extension including leading dot.
     */
    extname(p: string): string {
        const base = PlatformPath.basename(p);
        const idx = base.lastIndexOf('.');
        if (idx <= 0) return '';
        return base.slice(idx);
    },

    /**
     * Check if a path is absolute.
     */
    isAbsolute(p: string): boolean {
        if (!p || typeof p !== 'string') return false;
        const np = p.replace(/\\/g, '/');
        // Unix absolute or Windows drive (e.g. C:/)
        return np.startsWith('/') || /^[a-zA-Z]:\//.test(np);
    },

    /**
     * Normalize path for Obsidian.
     */
    normalize(p: string): string {
        return normalizePath(p);
    },

    /**
     * Access Node.js path module if on desktop (returns null on mobile).
     */
    getNodePath(): typeof import('path') | null {
        return getNodePath();
    },
};
