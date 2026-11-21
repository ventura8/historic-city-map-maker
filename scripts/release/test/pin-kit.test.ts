/** The starter kit's pins rewritten from a release (docs/research/M5-interfaces.md §2.6, §3.2). */
import { readKitEngine, type EngineRelease } from '@hcm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { RELEASE_JSON } from '../src/cdn.js';
import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, runCdn, runPinKit } from '../src/cli.js';
import { nodeReleaseFiles, readJsonObject } from '../src/files.js';
import { KIT_TEMPLATE, pinKitPage } from '../src/pin-kit.js';
import { ROOT, cleanup, fakeRepository, messages, recordingLogger, withEngineBuild } from './support.js';

afterEach(cleanup);

/** The committed template, read only. */
const TEMPLATE = nodeReleaseFiles(ROOT).readText(KIT_TEMPLATE);
/** Generated test digests (64 base64 characters each), never a real file's. */
const sri = (letter: string): string => `sha384-${letter.repeat(64)}`;

/** A release whose Mapbox GL JS pins are the template's own (read back from it). */
function releaseFor(template: string, version = '1.4.0'): EngineRelease {
    const attribute = (url: string): string => new RegExp(`"${url}"\\s+integrity="([^"]+)"`).exec(template)?.[1] ?? '';
    const css = 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css';
    const js = 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js';
    return {
        version,
        repository: 'ventura8/historic-city-map-maker',
        base: `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@v${version}/cdn/engine/`,
        mapboxGl: { version: '3.34.1', script: { url: js, integrity: attribute(js) }, stylesheet: { url: css, integrity: attribute(css) } },
        files: [
            { path: 'engine.css', bytes: 10, integrity: sri('c') },
            { path: 'engine.iife.js', bytes: 20, integrity: sri('j') },
        ],
    };
}

describe('pinKitPage', () => {
    it('happyPath_theTemplatesEngineBlockFollowsTheRelease', () => {
        const release = releaseFor(TEMPLATE);

        const page = pinKitPage(TEMPLATE, release);

        expect(readKitEngine(page)).toEqual({
            kind: 'cdn',
            release: {
                base: release.base,
                files: [
                    { path: 'engine.css', integrity: sri('c') },
                    { path: 'engine.iife.js', integrity: sri('j') },
                ],
            },
        });
        expect(page).toContain(`font-src ${release.base}`);
        expect(pinKitPage(page, release)).toBe(page);
    });

    it('badPath_aTemplateWithoutItsEngineBlockIsRefused', () => {
        const template = TEMPLATE.replace('<!-- hcm:engine -->', '');

        expect(() => pinKitPage(template, releaseFor(TEMPLATE))).toThrow(
            /^templates\/starter-kit\/index\.html: the kit page must hold one/,
        );
    });

    it('badPath_otherMapboxPinsThanTheReleasesAreRefused', () => {
        const release = {
            ...releaseFor(TEMPLATE),
            mapboxGl: {
                ...releaseFor(TEMPLATE).mapboxGl,
                script: { url: 'https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.js', integrity: sri('M') },
            },
        };

        expect(() => pinKitPage(TEMPLATE, release)).toThrow(
            `${KIT_TEMPLATE} does not pin Mapbox GL JS as release 1.4.0 does: https://api.mapbox.com/mapbox-gl-js/v3.33.0/mapbox-gl.js (${sri('M')})`,
        );
    });

    it('badPath_aBugInTheFillIsNotDisguised', () => {
        const release = { ...releaseFor(TEMPLATE), files: undefined } as unknown as EngineRelease;

        expect(() => pinKitPage(TEMPLATE, release)).toThrow(TypeError);
    });
});

describe('release:pin-kit', () => {
    it('happyPath_pinsTheTemplateToTheCommittedRelease', () => {
        const { files } = fakeRepository('1.0.0');
        withEngineBuild(files);
        files.write('node_modules/mapbox-gl/dist/mapbox-gl.js', 'x');
        const { log, records } = recordingLogger();
        runCdn([], { files, log });
        const release = readJsonObject(files, RELEASE_JSON) as unknown as EngineRelease;
        const template = TEMPLATE.replaceAll(releaseFor(TEMPLATE).mapboxGl.script.integrity, release.mapboxGl.script.integrity).replaceAll(
            releaseFor(TEMPLATE).mapboxGl.stylesheet.integrity,
            release.mapboxGl.stylesheet.integrity,
        );
        files.write(KIT_TEMPLATE, template);

        expect(runPinKit([], { files, log })).toBe(EXIT_OK);

        expect(readKitEngine(files.readText(KIT_TEMPLATE))).toMatchObject({ kind: 'cdn', release: { base: release.base } });
        expect(messages(records, 'info').at(-1)).toBe(`pinned ${KIT_TEMPLATE} to the engine 1.0.0`);
    });

    it('badPath_withoutTheTemplateNothingIsPinned', () => {
        const { files } = fakeRepository('1.0.0');
        const { log, records } = recordingLogger();

        expect(runPinKit([], { files, log })).toBe(EXIT_INVALID);
        expect(messages(records, 'error')).toEqual([`${KIT_TEMPLATE} is missing`]);
    });

    it('badPath_anArgumentIsAUsageError', () => {
        const { files } = fakeRepository('1.0.0');
        const { log, records } = recordingLogger();

        expect(runPinKit(['1.0.0'], { files, log })).toBe(EXIT_USAGE);
        expect(messages(records, 'error')).toEqual(['usage: release:pin-kit']);
    });
});
