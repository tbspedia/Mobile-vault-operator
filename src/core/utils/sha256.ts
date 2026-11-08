/**
 * sha256Hex -- hex SHA-256 of a UTF-8 string.
 *
 * One home for the cheap, synchronous hash the plugin uses in several
 * governance and cache paths (RunSkillScriptCache, the sandbox content-hash
 * grant). Node's crypto is a runtime builtin (Electron ships it). On mobile
 * where Node crypto is absent, a pure JavaScript fallback is used.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- Node crypto builtin for sha256 when on desktop */
let nodeCrypto: typeof import('crypto') | null = null;
try {
    nodeCrypto = require('crypto') as typeof import('crypto');
} catch {
    nodeCrypto = null;
}
/* eslint-enable @typescript-eslint/no-require-imports */

// @fork-mobile-start [Phase: 1, Issue: PureJsSha256Fallback]
function rightRotate(v: number, a: number): number {
    return (v >>> a) | (v << (32 - a));
}

function pureJsSha256(raw: string): string {
    const ascii = unescape(encodeURIComponent(raw));
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let i: number, j: number;
    let result = '';
    const words: number[] = [];
    const asciiBitLength = ascii.length * 8;
    const hash: number[] = [];
    const k: number[] = [];
    let primeCounter = 0;
    const isComposite: Record<number, number> = {};

    for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
            for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
            hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
            k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        }
    }

    let s = ascii + '\x80';
    while ((s.length % 64) - 56) s += '\x00';
    for (i = 0; i < s.length; i++) words[i >> 2] |= s.charCodeAt(i) << (((3 - i) % 4) * 8);
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength | 0;

    for (j = 0; j < words.length;) {
        const w = words.slice(j, (j += 16));
        const oldHash = hash.slice(0);
        for (i = 0; i < 64; i++) {
            const w15 = w[i - 15],
                w2 = w[i - 2],
                a = hash[0],
                e = hash[4];
            const temp1 =
                hash[7] +
                (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
                ((e & hash[5]) ^ (~e & hash[6])) +
                k[i] +
                (w[i] =
                    i < 16
                        ? w[i]
                        : (w[i - 16] +
                              (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                              w[i - 7] +
                              (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
                          0);
            const temp2 =
                (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
                ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
            hash[7] = hash[6];
            hash[6] = hash[5];
            hash[5] = hash[4];
            hash[4] = (hash[3] + temp1) | 0;
            hash[3] = hash[2];
            hash[2] = hash[1];
            hash[1] = hash[0];
            hash[0] = (temp1 + temp2) | 0;
        }
        for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
        for (j = 3; j >= 0; j--) {
            const b = (hash[i] >> (j * 8)) & 255;
            result += (b < 16 ? '0' : '') + b.toString(16);
        }
    }
    return result;
}
// @fork-mobile-end

/** Lower-case hex SHA-256 of the input, hashed as UTF-8 bytes. */
export function sha256Hex(input: string): string {
    if (nodeCrypto && typeof nodeCrypto.createHash === 'function') {
        return nodeCrypto.createHash('sha256').update(input, 'utf8').digest('hex');
    }
    return pureJsSha256(input);
}
