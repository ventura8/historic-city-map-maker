import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { gzipBytes, loadRelease, prepareFile, sha256Hex, StartFileError, StartReleaseError } from '../../src/start/files.js';

describe('the browser side of a release file', () => {
    it('happyPath_gzipRoundTripsAndTheHashIsHex', async () => {
        const bytes = new TextEncoder().encode('hello hosting');
        expect(gunzipSync(await gzipBytes(bytes)).toString()).toBe('hello hosting');
        expect(await sha256Hex(crypto.subtle, bytes)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('badPath_aSiteThatCannotBeReachedOrAnswersNoJson', async () => {
        const down = { fetch: () => Promise.reject(new TypeError('down')) };
        await expect(loadRelease(down, 'https://start.example.test/', 'r1')).rejects.toBeInstanceOf(StartReleaseError);
        const noJson = { fetch: () => Promise.resolve(new Response('not json')) };
        await expect(loadRelease(noJson, 'https://start.example.test/', 'r1')).rejects.toBeInstanceOf(StartReleaseError);
        const tools = { ...down, digest: () => Promise.resolve(''), gzip: (bytes: Uint8Array) => Promise.resolve(bytes) };
        const source = { baseUrl: 'https://start.example.test/', slug: 'r1' };
        const file = { path: 'index.html', bytes: 1, sha256: 'a'.repeat(64) };
        await expect(prepareFile(tools, source, file, 'p')).rejects.toBeInstanceOf(StartFileError);
    });
});
