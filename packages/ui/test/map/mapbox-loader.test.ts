import { FakeMapboxGl } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import {
    loadMapboxGl,
    MAPBOX_GL_CSS_URL,
    MAPBOX_GL_SCRIPT_URL,
    MAPBOX_INTEGRITY_ATTRIBUTE,
    pageIntegrity,
    type MapboxLoaderScope,
} from '../../src/map/mapbox-loader.js';
import type { MapboxGl } from '../../src/map/mapbox-types.js';

class FakeScript {
    src = '';
    crossOrigin: string | null = null;
    integrity = '';
    readonly #listeners = new Map<string, () => void>();

    addEventListener(type: string, listener: () => void): void {
        this.#listeners.set(type, listener);
    }

    dispatch(type: string): void {
        this.#listeners.get(type)?.();
    }
}

/** A digest of the shape the site build writes (`sha384-` and 64 base64 characters). */
const DIGEST = `sha384-${'A1b2+/'.repeat(10)}AbCd`;

/** A page whose `mapbox-gl.js` defines `mapboxgl` on load (or never does); `integrity` is its `<html>`'s attribute. */
class FakePage implements MapboxLoaderScope {
    mapboxgl?: MapboxGl;
    readonly scripts: FakeScript[] = [];
    readonly document: MapboxLoaderScope['document'];

    constructor(integrity?: string | null) {
        const attributes = new Map([[MAPBOX_INTEGRITY_ATTRIBUTE, integrity ?? null]]);
        this.document = {
            createElement: (): FakeScript => new FakeScript(),
            head: {
                append: (script: FakeScript): void => {
                    this.scripts.push(script);
                },
            },
            ...(integrity === undefined ? {} : { documentElement: { getAttribute: (name: string) => attributes.get(name) ?? null } }),
        } as unknown as MapboxLoaderScope['document'];
    }

    /** The script loads; `defines` says whether it set the global. */
    load(index: number, defines: boolean): void {
        if (defines) {
            this.mapboxgl = new FakeMapboxGl();
        }
        this.scripts[index]?.dispatch('load');
    }
}

describe('loading Mapbox GL JS', () => {
    it('happyPath_theFirstMapAddsThePinnedScriptOnce', async () => {
        const page = new FakePage();

        const first = loadMapboxGl(page);
        const second = loadMapboxGl(page);
        page.load(0, true);

        await expect(first).resolves.toBe(page.mapboxgl);
        await expect(second).resolves.toBe(page.mapboxgl);
        await expect(loadMapboxGl(page)).resolves.toBe(page.mapboxgl);
        expect(page.scripts).toHaveLength(1);
        expect(page.scripts[0]).toMatchObject({ src: MAPBOX_GL_SCRIPT_URL, crossOrigin: 'anonymous', integrity: '' });
        expect(MAPBOX_GL_SCRIPT_URL).toBe('https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js');
        expect(MAPBOX_GL_CSS_URL).toBe('https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css');
    });

    it('badPath_aFailedOrEmptyLoadRejectsAndTheNextMapTriesAgain', async () => {
        const page = new FakePage();

        const failed = loadMapboxGl(page);
        page.scripts[0]?.dispatch('error');
        await expect(failed).rejects.toThrow('mapbox-gl.js failed to load');
        const empty = loadMapboxGl(page);
        page.load(1, false);
        await expect(empty).rejects.toThrow('mapbox-gl.js did not define mapboxgl');
        const retried = loadMapboxGl(page);
        page.load(2, true);

        await expect(retried).resolves.toBe(page.mapboxgl);
        expect(page.scripts).toHaveLength(3);
    });

    it('happyPath_theScriptCarriesTheDigestThePageNames', async () => {
        const page = new FakePage(DIGEST);

        const loading = loadMapboxGl(page);
        page.load(0, true);

        await expect(loading).resolves.toBe(page.mapboxgl);
        expect(page.scripts[0]).toMatchObject({ src: MAPBOX_GL_SCRIPT_URL, crossOrigin: 'anonymous', integrity: DIGEST });
    });

    it.each([
        ['no attribute', null],
        ['an empty attribute', ''],
        ['a SHA-256 digest', `sha256-${'A'.repeat(43)}=`],
        ['a digest with a space', `${DIGEST} `],
    ])('badPath_%sLoadsTheScriptWithoutADigest', (_name, attribute) => {
        const page = new FakePage(attribute);

        void loadMapboxGl(page);

        expect(pageIntegrity(page)).toBeNull();
        expect(page.scripts[0]?.integrity).toBe('');
    });
});
