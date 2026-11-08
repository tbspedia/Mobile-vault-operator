/**
 * GlobalFileService
 *
 * FileAdapter implementation backed by Node.js `fs` at {vault-parent}/.obsidian-agent/
 * on desktop, or Obsidian's vault.adapter at {vault}/.vault-operator/data/ on mobile.
 * Used by all services whose data is shared across vaults (memory, history,
 * rules, workflows, skills, recipes, episodes, logs, etc.).
 *
 * FEATURE-1508: Root changed from ~/.obsidian-agent/ to {vault-parent}/.obsidian-agent/
 * so that all global data lives next to the vault and syncs via iCloud/OneDrive/etc.
 */

import type { FileAdapter } from './types';
import * as fsModule from '../security/safeFs';
import osModule from 'os';
import pathModule from 'path';
// @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileSupport]
import { Platform, normalizePath, type DataAdapter } from 'obsidian';
import { PlatformPath } from '../platform/PlatformPath';
import { atomicAdapterWrite } from '../utils/atomicAdapterWrite';
// @fork-mobile-end

/** Cross-vault data directory next to the vault. Fresh installs get
 *  "vault-operator-shared". Existing installs may still be on the
 *  legacy names; the constructor below detects them and stays put,
 *  so no migration is required for current users. */
const GLOBAL_DIR_NAME = 'vault-operator-shared';
/** Legacy names. Looked up in order; the first existing one wins. */
const LEGACY_GLOBAL_DIR_NAMES = ['obsilo-shared', '.obsidian-agent'] as const;
/** Legacy name. Used by onload migration to detect old installs. */
export const LEGACY_GLOBAL_DIR_NAME = '.obsidian-agent';

/** Owner-only file mode for POSIX. Windows relies on user-profile ACLs
 *  and ignores POSIX modes, so the chmod path is platform-gated below. */
const OWNER_ONLY_MODE = 0o600;
const IS_WINDOWS = typeof process !== 'undefined' && process.platform === 'win32';

/** Best-effort chmod to 0o600. Skipped on Windows. Errors are swallowed
 *  because they are non-fatal (the file content is already persisted) and
 *  may surface on filesystems that do not honor POSIX modes (FAT, exFAT). */
async function chmodOwnerOnly(absPath: string): Promise<void> {
    if (IS_WINDOWS || !Platform.isDesktopApp) return;
    try {
        await fsModule.promises.chmod(absPath, OWNER_ONLY_MODE);
    } catch {
        // Non-fatal: filesystem may not support POSIX modes. The audit
        // remediation flagged this as best-effort (M-6 in AUDIT-034).
    }
}

/**
 * Optional hint to short-circuit the legacy-folder probe. When the caller
 * already knows that the FEAT-29-01 layout migration is complete, the
 * constructor lands directly on {vault}/{agentFolderPath}/data/ instead of
 * probing legacy paths.
 */
export interface GlobalFileServiceLayoutHint {
    /** Vault-relative agent folder (e.g. ".vault-operator"). */
    agentFolderPath: string;
    /** FEAT-29-01 migration status from vault-local settings: 'pending' | 'in-progress' | 'complete' (forward-compatible with unknown values). */
    layoutMigrationStatus: string;
}

export class GlobalFileService implements FileAdapter {
    private root: string;
    private readonly vaultBasePath: string | undefined;
    private readonly vaultAdapter?: DataAdapter;

    /**
     * @param vaultBasePath - Absolute path to the vault root (from vault.adapter.getBasePath()).
     * @param layoutHint - When `layoutMigrationStatus === 'complete'` the constructor lands directly on {vault}/{agentFolderPath}/data/.
     * @param vaultAdapter - Obsidian DataAdapter for mobile companion execution.
     */
    constructor(
        vaultBasePath?: string,
        layoutHint?: GlobalFileServiceLayoutHint,
        vaultAdapter?: DataAdapter,
    ) {
        this.vaultBasePath = vaultBasePath;
        this.vaultAdapter = vaultAdapter;

        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileConstructor]
        if (!Platform.isDesktopApp) {
            const folder = layoutHint?.agentFolderPath ?? '.vault-operator';
            this.root = `${folder}/data`;
            return;
        }
        // @fork-mobile-end

        // Boot-Race fix: if the FEAT-29-01 layout migration is already
        // complete and we have a vault path, skip the legacy probe and land
        // directly on the consolidated data root.
        if (
            vaultBasePath
            && layoutHint?.layoutMigrationStatus === 'complete'
            && layoutHint.agentFolderPath
        ) {
            this.root = pathModule.join(vaultBasePath, layoutHint.agentFolderPath, 'data');
            return;
        }

        const baseDir = vaultBasePath ? pathModule.dirname(vaultBasePath) : osModule.homedir();

        // Prefer existing legacy folders if they exist (preserves user data).
        for (const legacy of LEGACY_GLOBAL_DIR_NAMES) {
            const candidate = pathModule.join(baseDir, legacy);
            if (fsModule.probePathExists(candidate)) {
                this.root = candidate;
                return;
            }
        }

        this.root = pathModule.join(baseDir, GLOBAL_DIR_NAME);
    }

    /**
     * FEAT-29-01: switch this service to the vault-local data layout
     * ({vault}/<agentFolderPath>/data/).
     */
    useVaultLocalRoot(agentFolderPath: string): void {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceVaultLocalMobile]
        if (!Platform.isDesktopApp) {
            this.root = `${agentFolderPath}/data`;
            return;
        }
        // @fork-mobile-end
        if (!this.vaultBasePath) return;
        const newRoot = pathModule.join(this.vaultBasePath, agentFolderPath, 'data');
        this.root = newRoot;
    }

    /** Return the legacy root path (~/.obsidian-agent/) for migration purposes. */
    static getLegacyRoot(): string {
        if (!Platform.isDesktopApp) return '.vault-operator/data';
        return pathModule.join(osModule.homedir(), LEGACY_GLOBAL_DIR_NAME);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Resolve a relative path to an absolute path under the root (or vault-relative on mobile). */
    resolvePath(relativePath: string): string {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceResolveMobile]
        if (!Platform.isDesktopApp) {
            return PlatformPath.join(this.root, relativePath);
        }
        // @fork-mobile-end
        const resolved = pathModule.join(this.root, relativePath);
        // H-5: Prevent path traversal — resolved path must stay within root
        if (!resolved.startsWith(this.root + pathModule.sep) && resolved !== this.root) {
            throw new Error(`Path traversal blocked: ${relativePath}`);
        }
        return resolved;
    }

    /** Return the root directory path (~/.obsidian-agent/ or vault-relative on mobile). */
    getRoot(): string {
        return this.root;
    }

    // ── FileAdapter implementation ───────────────────────────────────────────

    async exists(p: string): Promise<boolean> {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileExists]
        if (!Platform.isDesktopApp && this.vaultAdapter) {
            return this.vaultAdapter.exists(normalizePath(this.resolvePath(p)));
        }
        // @fork-mobile-end
        try {
            await fsModule.promises.access(this.resolvePath(p));
            return true;
        } catch {
            return false;
        }
    }

    async read(p: string): Promise<string> {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileRead]
        if (!Platform.isDesktopApp && this.vaultAdapter) {
            return this.vaultAdapter.read(normalizePath(this.resolvePath(p)));
        }
        // @fork-mobile-end
        return fsModule.promises.readFile(this.resolvePath(p), 'utf-8');
    }

    private async writeAtomic(abs: string, data: string | Uint8Array): Promise<void> {
        await fsModule.promises.mkdir(pathModule.dirname(abs), { recursive: true });
        const tmp = `${abs}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        try {
            await fsModule.promises.writeFile(
                tmp,
                data,
                typeof data === 'string'
                    ? { encoding: 'utf-8', mode: OWNER_ONLY_MODE }
                    : { mode: OWNER_ONLY_MODE },
            );
            await chmodOwnerOnly(tmp);
            await fsModule.promises.rename(tmp, abs);
        } catch (e) {
            try { await fsModule.promises.unlink(tmp); } catch { /* nothing to clean */ }
            throw e;
        }
    }

    async write(p: string, data: string): Promise<void> {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileWrite]
        if (!Platform.isDesktopApp && this.vaultAdapter) {
            const normalized = normalizePath(this.resolvePath(p));
            await this.mkdir(PlatformPath.dirname(p));
            await atomicAdapterWrite(this.vaultAdapter, normalized, data);
            return;
        }
        // @fork-mobile-end
        await this.writeAtomic(this.resolvePath(p), data);
    }

    /** Binary read for SQLite DBs and other non-UTF8 payloads. */
    async readBinary(p: string): Promise<Uint8Array> {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileReadBinary]
        if (!Platform.isDesktopApp && this.vaultAdapter) {
            const buf = await this.vaultAdapter.readBinary(normalizePath(this.resolvePath(p)));
            return new Uint8Array(buf);
        }
        // @fork-mobile-end
        const buf = await fsModule.promises.readFile(this.resolvePath(p));
        return new Uint8Array(buf);
    }

    /** Binary write counterpart. */
    async writeBinary(p: string, data: Uint8Array): Promise<void> {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileWriteBinary]
        if (!Platform.isDesktopApp && this.vaultAdapter) {
            const normalized = normalizePath(this.resolvePath(p));
            await this.mkdir(PlatformPath.dirname(p));
            await this.vaultAdapter.writeBinary(normalized, data);
            return;
        }
        // @fork-mobile-end
        await this.writeAtomic(this.resolvePath(p), data);
    }

    async mkdir(p: string): Promise<void> {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileMkdir]
        if (!Platform.isDesktopApp && this.vaultAdapter) {
            const normalized = normalizePath(this.resolvePath(p));
            const parts = normalized.split('/').filter((s) => s.length > 0);
            let current = '';
            for (const part of parts) {
                current = current ? `${current}/${part}` : part;
                if (!(await this.vaultAdapter.exists(current))) {
                    await this.vaultAdapter.mkdir(current);
                }
            }
            return;
        }
        // @fork-mobile-end
        await fsModule.promises.mkdir(this.resolvePath(p), { recursive: true });
    }

    async list(p: string): Promise<{ files: string[]; folders: string[] }> {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileList]
        if (!Platform.isDesktopApp && this.vaultAdapter) {
            const target = normalizePath(this.resolvePath(p));
            if (!(await this.vaultAdapter.exists(target))) {
                return { files: [], folders: [] };
            }
            const listed = await this.vaultAdapter.list(target);
            const prefix = p ? `${p}/` : '';
            const rootPrefix = `${this.root}/`;
            return {
                files: listed.files.map(f => f.startsWith(rootPrefix) ? f.slice(rootPrefix.length) : f).sort(),
                folders: listed.folders.map(f => f.startsWith(rootPrefix) ? f.slice(rootPrefix.length) : f).sort(),
            };
        }
        // @fork-mobile-end
        const abs = this.resolvePath(p);
        try {
            const entries = await fsModule.promises.readdir(abs, { withFileTypes: true });
            const files: string[] = [];
            const folders: string[] = [];
            for (const entry of entries) {
                const relPath = p ? `${p}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    folders.push(relPath);
                } else {
                    files.push(relPath);
                }
            }
            return { files: files.sort(), folders: folders.sort() };
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
                return { files: [], folders: [] };
            }
            throw err;
        }
    }

    async remove(p: string): Promise<void> {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileRemove]
        if (!Platform.isDesktopApp && this.vaultAdapter) {
            const target = normalizePath(this.resolvePath(p));
            if (await this.vaultAdapter.exists(target)) {
                await this.vaultAdapter.remove(target);
            }
            return;
        }
        // @fork-mobile-end
        const abs = this.resolvePath(p);
        const stat = await fsModule.promises.stat(abs).catch(() => null);
        if (!stat) return;
        if (stat.isDirectory()) {
            await fsModule.promises.rm(abs, { recursive: true, force: true });
        } else {
            await fsModule.promises.unlink(abs);
        }
    }

    async append(p: string, data: string): Promise<void> {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileAppend]
        if (!Platform.isDesktopApp && this.vaultAdapter) {
            const target = normalizePath(this.resolvePath(p));
            await this.mkdir(PlatformPath.dirname(p));
            await this.vaultAdapter.append(target, data);
            return;
        }
        // @fork-mobile-end
        const abs = this.resolvePath(p);
        await fsModule.promises.mkdir(pathModule.dirname(abs), { recursive: true });
        await fsModule.promises.appendFile(abs, data, { encoding: 'utf-8', mode: OWNER_ONLY_MODE });
        await chmodOwnerOnly(abs);
    }

    async stat(p: string): Promise<{ mtime: number; size: number } | null> {
        // @fork-mobile-start [Phase: 1, Issue: GlobalFileServiceMobileStat]
        if (!Platform.isDesktopApp && this.vaultAdapter) {
            const target = normalizePath(this.resolvePath(p));
            const s = await this.vaultAdapter.stat(target);
            return s ? { mtime: s.mtime, size: s.size } : null;
        }
        // @fork-mobile-end
        try {
            const s = await fsModule.promises.stat(this.resolvePath(p));
            return { mtime: s.mtimeMs, size: s.size };
        } catch {
            return null;
        }
    }
}
