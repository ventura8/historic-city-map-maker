/** Engine releases on jsDelivr (M5; docs/research/M5-interfaces.md §2): tags, pinned addresses, `release.json`. */
import { describe, expect, it } from 'vitest';

import {
    ENGINE_CDN_FOLDER,
    ENGINE_PAGE_FILES,
    ENGINE_REPOSITORY,
    engineCdnBase,
    engineCdnUrl,
    engineMajorBase,
    engineReleaseSchema,
    isPrerelease,
    releaseDistTag,
    releaseIntegrity,
    releaseTag,
    SRI_PATTERN,
    versionOfTag,
    type EngineRelease,
} from '../../src/schemas/engine-release.js';
import { validate } from '../../src/schemas/validation.js';

const BASE = 'https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@v1.0.0/cdn/engine/';
/** Generated test digests (64 base64 characters each), never a real file's. */
const sri = (letter: string): string => `sha384-${letter.repeat(64)}`;

function release(changes: Partial<EngineRelease> = {}): EngineRelease {
    return {
        version: '1.0.0',
        repository: ENGINE_REPOSITORY,
        base: BASE,
        mapboxGl: {
            version: '3.34.1',
            script: { url: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js', integrity: sri('M') },
            stylesheet: { url: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css', integrity: sri('N') },
        },
        files: [
            { path: 'engine.iife.js', bytes: 424_503, integrity: sri('A') },
            { path: 'engine.css', bytes: 272, integrity: sri('B') },
            { path: 'fonts/roboto-flex-latin-wght.woff2', bytes: 34_320, integrity: sri('C') },
        ],
        ...changes,
    };
}

describe('release tags', () => {
    it.each([
        ['1.0.0', 'v1.0.0'],
        ['2.13.104', 'v2.13.104'],
        ['01.0.0', 'v1.0.0'],
        ['1.0.0-beta.1', 'v1.0.0-beta.1'],
        ['1.0.0-rc.0', 'v1.0.0-rc.0'],
        ['2.1.0-rc.12', 'v2.1.0-rc.12'],
    ])('happyPath_version %s_is tag %s', (version, tag) => {
        expect(releaseTag(version)).toBe(tag);
    });

    it.each([
        '1.0',
        'v1.0.0',
        '1.0.0-alpha.1',
        '1.0.0-beta',
        '1.0.0-beta.01',
        '1.0.0-BETA.1',
        '1.0.0-rc.1.1',
        '1.0.0+build',
        '1.0.0-beta.1+build',
        'latest',
    ])('badPath_%s_isNoReleaseVersion', (version) => {
        expect(() => releaseTag(version)).toThrow(RangeError);
    });

    it.each([
        ['1.0.0', false, 'latest'],
        ['1.0.0-beta.1', true, 'beta'],
        ['1.0.0-rc.2', true, 'rc'],
    ])('happyPath_%s_isPrerelease_%s_withDistTag_%s', (version, prerelease, distTag) => {
        expect(isPrerelease(version)).toBe(prerelease);
        expect(releaseDistTag(version)).toBe(distTag);
    });

    it('badPath_aVersionOfAnotherFormHasNoChannel', () => {
        expect(() => isPrerelease('1.0.0-alpha.1')).toThrow(RangeError);
        expect(() => releaseDistTag('next')).toThrow(RangeError);
    });

    it.each([
        ['v1.0.0', '1.0.0'],
        ['v10.2.33', '10.2.33'],
        ['v01.0.0', null],
        ['1.0.0', null],
        ['v1.0.0-rc.1', '1.0.0-rc.1'],
        ['v1.0.0-beta.1', '1.0.0-beta.1'],
        ['v1.0.0-beta.01', null],
        ['v1.0.0-alpha.1', null],
        ['v1.0.0-rc.1+build', null],
        ['legacy-2022', null],
    ])('versionOfTag_%s_is_%s', (tag, version) => {
        expect(versionOfTag(tag)).toBe(version);
    });
});

describe('pinned jsDelivr addresses', () => {
    it('happyPath_aReleaseIsServedFromItsTagsCdnFolder', () => {
        expect(engineCdnBase('1.0.0')).toBe(BASE);
        expect(engineCdnBase('1.0.0').endsWith(`/${ENGINE_CDN_FOLDER}/`)).toBe(true);
        expect(engineCdnUrl('1.0.0', ENGINE_PAGE_FILES.script)).toBe(`${BASE}engine.iife.js`);
        expect(engineCdnUrl('1.0.0', 'fonts/roboto-flex-latin-wght.woff2', 'someone/their-fork')).toBe(
            'https://cdn.jsdelivr.net/gh/someone/their-fork@v1.0.0/cdn/engine/fonts/roboto-flex-latin-wght.woff2',
        );
    });

    it('happyPath_theMajorLineFloats', () => {
        expect(engineMajorBase('1.4.2')).toBe('https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@1/cdn/engine/');
    });

    it('happyPath_aPreReleaseIsPinnedAtItsFullVersion', () => {
        expect(engineCdnBase('1.0.0-beta.1')).toBe(
            'https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@v1.0.0-beta.1/cdn/engine/',
        );
    });

    it('badPath_aPreReleaseHasNoMajorLine', () => {
        expect(() => engineMajorBase('1.0.0-beta.1')).toThrow('a pre-release has no major line');
    });

    it.each(['../release.json', '/engine.css', 'fonts/../../x.js', '.hidden', 'a//b', ''])('badPath_file %j_throws', (file) => {
        expect(() => engineCdnUrl('1.0.0', file)).toThrow(RangeError);
    });

    it('badPath_aVersionThatIsNoReleaseThrows', () => {
        expect(() => engineMajorBase('one')).toThrow(RangeError);
        expect(() => engineCdnBase('1.0')).toThrow(RangeError);
    });
});

describe('release.json', () => {
    it('happyPath_aReleaseListsEveryFileWithItsIntegrity', () => {
        expect(validate(engineReleaseSchema, release()).ok).toBe(true);
        expect(SRI_PATTERN.test(sri('A'))).toBe(true);
    });

    it('happyPath_aPreReleaseListsItsFullVersionAndFolder', () => {
        const pre = release({ version: '1.0.0-beta.1', base: BASE.replace('@v1.0.0', '@v1.0.0-beta.1') });
        expect(validate(engineReleaseSchema, pre).ok).toBe(true);
    });

    it.each([
        ['a base of another version', { base: BASE.replace('@v1.0.0', '@v1.0.1') }],
        ['a floating base', { base: engineMajorBase('1.0.0') }],
        ['a version that is no version', { version: '1.0' }],
        ['an alpha pre-release', { version: '1.0.0-alpha.1' }],
        ['a file listed twice', { files: [...release().files, { path: 'engine.css', bytes: 272, integrity: sri('D') }] }],
        ['no stylesheet', { files: release().files.filter((file) => file.path !== 'engine.css') }],
        ['the release file listing itself', { files: [...release().files, { path: 'release.json', bytes: 900, integrity: sri('E') }] }],
        [
            'a sha256 integrity',
            { files: [{ path: 'engine.iife.js', bytes: 1, integrity: `sha256-${'A'.repeat(43)}=` }, release().files[1]] },
        ],
        ['an empty file', { files: [{ path: 'engine.iife.js', bytes: 0, integrity: sri('A') }, release().files[1]] }],
    ])('badPath_%s_isRefused', (_name, change) => {
        expect(validate(engineReleaseSchema, { ...release(), ...change }).ok).toBe(false);
    });

    it('happyPath_theIntegrityOfAFileIsLookedUp', () => {
        expect(releaseIntegrity(release(), 'engine.iife.js')).toBe(sri('A'));
        expect(releaseIntegrity(release(), 'engine.mjs')).toBeUndefined();
    });
});
