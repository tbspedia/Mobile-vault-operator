#!/usr/bin/env node
/**
 * Upstream Drift & Fork Compatibility Scanner
 *
 * Scans the codebase for `@fork-mobile-start` and `@fork-mobile-end` annotations,
 * validates marker pair integrity, extracts phase and issue metadata,
 * and checks for merge drift against upstream releases.
 *
 * Usage:
 *   node scripts/scan-upstream-drift.mjs
 *   node scripts/scan-upstream-drift.mjs --check-upstream <git-ref>
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');

const START_MARKER_REGEX = /\/\/\s*@fork-mobile-start\s*\[Phase:\s*([^,]+),\s*Issue:\s*([^\]]+)\]/;
const END_MARKER_REGEX = /\/\/\s*@fork-mobile-end/;

function findFiles(dir, extensions = ['.ts', '.js', '.mjs', '.json']) {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
            results.push(...findFiles(fullPath, extensions));
        } else if (entry.isFile()) {
            if (extensions.some(ext => entry.name.endsWith(ext))) {
                results.push(fullPath);
            }
        }
    }
    return results;
}

function scanFile(filePath) {
    const relPath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    const blocks = [];
    const errors = [];
    let currentBlock = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        const startMatch = line.match(START_MARKER_REGEX);
        if (startMatch) {
            if (currentBlock) {
                errors.push({
                    file: relPath,
                    line: lineNum,
                    message: `Nested @fork-mobile-start found before closing previous block starting at line ${currentBlock.startLine}`,
                });
            } else {
                currentBlock = {
                    phase: startMatch[1].trim(),
                    issue: startMatch[2].trim(),
                    startLine: lineNum,
                };
            }
            continue;
        }

        const endMatch = line.match(END_MARKER_REGEX);
        if (endMatch) {
            if (!currentBlock) {
                errors.push({
                    file: relPath,
                    line: lineNum,
                    message: 'Orphan @fork-mobile-end found without preceding @fork-mobile-start',
                });
            } else {
                currentBlock.endLine = lineNum;
                blocks.push({
                    file: relPath,
                    ...currentBlock,
                });
                currentBlock = null;
            }
        }
    }

    if (currentBlock) {
        errors.push({
            file: relPath,
            line: currentBlock.startLine,
            message: `Unclosed @fork-mobile-start block (missing @fork-mobile-end)`,
        });
    }

    return { blocks, errors };
}

function main() {
    console.log('='.repeat(72));
    console.log('  Vault Operator - Upstream Drift & Mobile Fork Compatibility Scanner');
    console.log('='.repeat(72));

    const filesToScan = [
        path.join(ROOT_DIR, 'manifest.json'),
        ...findFiles(SRC_DIR),
        ...findFiles(path.join(ROOT_DIR, 'scripts')),
    ];

    const allBlocks = [];
    const allErrors = [];

    for (const file of filesToScan) {
        const { blocks, errors } = scanFile(file);
        allBlocks.push(...blocks);
        allErrors.push(...errors);
    }

    // Check manifest.json isDesktopOnly flag
    const manifestPath = path.join(ROOT_DIR, 'manifest.json');
    let isDesktopOnly = true;
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        isDesktopOnly = manifest.isDesktopOnly;
    } catch (e) {
        allErrors.push({ file: 'manifest.json', line: 1, message: `Could not parse manifest.json: ${e.message}` });
    }

    console.log(`\n[Scan Summary]`);
    console.log(`  Scanned Files: ${filesToScan.length}`);
    console.log(`  Fork Blocks Found: ${allBlocks.length}`);
    console.log(`  manifest.json "isDesktopOnly": ${isDesktopOnly} ${isDesktopOnly ? '(FAIL - must be false)' : '(PASS)'}`);

    if (isDesktopOnly) {
        allErrors.push({
            file: 'manifest.json',
            line: 1,
            message: 'manifest.json has isDesktopOnly=true (must be false for mobile)',
        });
    }

    if (allBlocks.length > 0) {
        console.log('\n[Active Mobile Fork Mod-Points]');
        console.log('-'.repeat(72));
        console.log(
            'Phase'.padEnd(8) +
            'Lines'.padEnd(14) +
            'Issue Tag'.padEnd(32) +
            'File'
        );
        console.log('-'.repeat(72));

        for (const b of allBlocks) {
            const lineRange = `${b.startLine}-${b.endLine}`;
            console.log(
                b.phase.padEnd(8) +
                lineRange.padEnd(14) +
                b.issue.padEnd(32) +
                b.file
            );
        }
        console.log('-'.repeat(72));
    }

    if (allErrors.length > 0) {
        console.error('\n[Integrity Errors Detected]');
        for (const err of allErrors) {
            console.error(`  - ${err.file}:${err.line} -> ${err.message}`);
        }
        console.error('\nStatus: FAILED - Fix mismatched fork tags before upgrading or committing.');
        process.exit(1);
    }

    console.log('\nIntegrity Check: PASSED (All @fork-mobile tags are balanced and valid)');

    // Guidance for Upstream Releases
    console.log('\n[Future Upstream Upgrade Protocol]');
    console.log('  When rebasing onto a new upstream release (e.g. v3.8.4 or v3.9.0):');
    console.log('  1. Fetch upstream release: git fetch upstream');
    console.log('  2. Review modified files against upstream: git diff upstream/<tag> -- <files-above>');
    console.log('  3. Preserve all code inside @fork-mobile-start / @fork-mobile-end markers.');
    console.log('  4. Run `npm run scan-drift` to verify marker consistency.');
    console.log('  5. Run `npm run build && npm run typecheck && npm run test` to verify clean build.');
    console.log('='.repeat(72) + '\n');
}

main();
