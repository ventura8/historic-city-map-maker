import { describe, expect, it } from 'vitest';

import { checkManifestCompat, compareVersions, parseReleaseVersion, parseVersion } from '../../src/schemas/compat.js';
import { validManifest } from '../fixtures/manifest.js';

describe('versions', () => {
    it('happyPath_parsesMajorMinorPatch', () => {
        expect(parseVersion('1.12.3')).toEqual([1, 12, 3]);
    });

    it.each([['1.2'], ['v1.2.3'], ['1.2.3-rc.1'], ['']])('badPath_%s_isNotAVersion', (text) => {
        expect(parseVersion(text)).toBeNull();
    });

    it.each([
        ['1.2.3', '1.2.3', 0],
        ['2.0.0', '1.9.9', 1],
        ['1.3.0', '1.2.9', 1],
        ['1.2.4', '1.2.3', 1],
        ['1.2.3', '1.2.10', -7],
        ['1.0.0-beta.1', '1.0.0', -2],
        ['1.0.0-rc.1', '1.0.0-beta.9', 1],
        ['1.0.0-beta.2', '1.0.0-beta.1', 1],
        ['1.0.0-rc.3', '1.0.0-rc.3', 0],
        ['1.0.1-beta.0', '1.0.0', 1],
    ])('happyPath_compare_%s_with_%s', (a, b, expected) => {
        expect(compareVersions(a, b)).toBe(expected);
    });

    it.each([
        ['1.2', '1.2.3'],
        ['1.2.3', 'x'],
        ['1.2.3-alpha.1', '1.2.3'],
        ['1.2.3', '1.2.3-beta.01'],
    ])('badPath_compare_%s_with_%s_isNull', (a, b) => {
        expect(compareVersions(a, b)).toBeNull();
    });

    it('happyPath_parsesAPreRelease', () => {
        expect(parseReleaseVersion('1.0.0-beta.1')).toEqual({ core: [1, 0, 0], prerelease: { channel: 'beta', number: 1 } });
        expect(parseReleaseVersion('2.3.4')).toEqual({ core: [2, 3, 4], prerelease: null });
    });

    it.each(['1.0.0-beta', '1.0.0-rc.01', 'v1.0.0-beta.1', '1.0.0-beta.1+abc'])('badPath_%s_isNoReleaseVersion', (text) => {
        expect(parseReleaseVersion(text)).toBeNull();
    });

    it('happyPath_aBetaEngineIsTooOldForAManifestThatNeedsTheRelease', () => {
        const manifest = { version: 1, city: { engine: { minVersion: '1.0.0' } } };

        expect(checkManifestCompat(manifest, '1.0.0-beta.1')).toEqual({
            ok: false,
            code: 'error.manifest.engineTooOld',
            minVersion: '1.0.0',
        });
        expect(checkManifestCompat(manifest, '1.0.0')).toEqual({ ok: true });
    });
});

describe('checkManifestCompat', () => {
    it.each([['1.0.0'], ['1.4.2']])('happyPath_engine_%s_readsTheManifest', (engine) => {
        expect(checkManifestCompat(validManifest(), engine)).toEqual({ ok: true });
    });

    it('happyPath_noMinimumVersion', () => {
        expect(checkManifestCompat({ version: 1, city: {} }, '0.0.0')).toEqual({ ok: true });
    });

    it('badPath_aNewerManifestNamesTheEngineItNeeds', () => {
        const manifest = { version: 1, city: { engine: { minVersion: '1.3.0' } } };

        expect(checkManifestCompat(manifest, '1.2.9')).toEqual({ ok: false, code: 'error.manifest.engineTooOld', minVersion: '1.3.0' });
    });

    it('badPath_aMalformedMinimumIsLeftToTheSchema', () => {
        expect(checkManifestCompat({ version: 1, city: { engine: { minVersion: 'soon' } } }, '1.0.0')).toEqual({ ok: true });
    });

    it.each([[null], [[]], [{ version: 2 }], [{ version: '1' }], [{}], ['manifest']])('badPath_unsupportedVersion_%j', (input) => {
        expect(checkManifestCompat(input, '1.0.0')).toEqual({ ok: false, code: 'error.manifest.version' });
    });
});
