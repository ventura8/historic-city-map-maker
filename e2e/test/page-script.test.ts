import { afterEach, describe, expect, test } from 'vitest';

import { callLibrary, libraryKey, libraryScript } from '../support/page-script.js';

/** e2e/support/page-script.ts: a library of probe helpers installed in the page once, then called by name. */

function double(value: number): number {
    return value * 2;
}

function twice(value: number): number {
    return double(double(value));
}

async function later(value: number): Promise<number> {
    return Promise.resolve(value + 1);
}

afterEach(() => {
    delete (window as unknown as { hcmLibraries?: unknown }).hcmLibraries;
});

describe('libraryScript', () => {
    test('happyPath_declaresEveryHelperOnceAndInstallsThemUnderTheSetsKey', () => {
        const script = libraryScript([double, twice, double]);
        expect(script.match(/function double/g)).toHaveLength(1);
        expect(script).toContain('function twice');
        expect(script).toContain(`scope.hcmLibraries["${libraryKey([double, twice, double])}"] = { double, twice };`);
    });

    test('happyPath_aKeyPerSetOfNames', () => {
        expect(libraryKey([double, twice])).toMatch(/^hcm-[0-9a-f]+$/);
        expect(libraryKey([double, twice])).toBe(libraryKey([double, twice]));
        expect(libraryKey([double])).not.toBe(libraryKey([double, twice]));
    });
});

describe('callLibrary', () => {
    test('happyPath_callsTheInstalledEntryAndAwaitsIt', async () => {
        (window as unknown as { hcmLibraries: unknown }).hcmLibraries = { set: { twice, later } };
        await expect(callLibrary(['set', 'twice', 3])).resolves.toEqual({ result: 12 });
        await expect(callLibrary(['set', 'later', 1])).resolves.toEqual({ result: 2 });
    });

    test('badPath_aNewPageHasNoLibraryYet', async () => {
        await expect(callLibrary(['set', 'twice', 3])).resolves.toEqual({ missing: true });
        (window as unknown as { hcmLibraries: unknown }).hcmLibraries = { set: {} };
        await expect(callLibrary(['set', 'twice', 3])).resolves.toEqual({ missing: true });
        await expect(callLibrary(['other', 'twice', 3])).resolves.toEqual({ missing: true });
    });
});
