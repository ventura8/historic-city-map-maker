import { describe, expect, it } from 'vitest';

import { areaServices } from '../../src/app/content-wiring.js';

/**
 * The areas' services as the entry builds them (`docs/research/M2c-interfaces.md` §2.2): the photos' uploads and the pois'
 * map factory over the page's Firebase handles. In Node there is no Firestore behind the handles, so the map factory's
 * read of `setup/status` fails, and the page then shows the unavailable map instead of loading Mapbox GL.
 */
describe('the areas services', () => {
    it('badPath_withoutAReadableSetupStatusTheMapIsUnavailableAndNothingLoads', async () => {
        const services = areaServices({ handles: { firestore: {}, storage: {} } as never, fetch });

        const result = await services.maps?.create({} as HTMLElement, {
            bounds: [
                [25.9, 44.3],
                [26.3, 44.6],
            ],
            view: { center: [26.1, 44.43], zoom: 13, bearing: 0 },
            locale: 'ro',
        });

        expect(result).toEqual({ ok: false, reason: 'no-token' });
        expect(services.uploads).toBeDefined();
    });

    it('happyPath_theLayerEditorsCropLoadsItsChunkAndRegistersItsElement', async () => {
        const services = areaServices({ handles: { firestore: {}, storage: {} } as never, fetch });

        await expect(services.layerCrop?.()).resolves.toBeTypeOf('function');
        expect(globalThis.customElements.get('hcm-layer-crop')).toBeDefined();
    });

    it('happyPath_theE2eBuildPushesThroughTheStandInWithTheTestsToken', async () => {
        const services = areaServices({ handles: { firestore: {}, storage: {} } as never, fetch, pushTest: 'S-A47' });
        const production = areaServices({ handles: { firestore: {}, storage: {}, app: {} } as never, fetch });

        await expect(services.push?.token()).resolves.toBe('e2e-fcm-token:S-A47-browser-0001');
        expect(production.push).toBeDefined();
    });
});
