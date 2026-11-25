import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { frontShotDirection } from '../../src/viewer/shot-direction.js';
import { defineViewerElements } from '../../src/viewer/define.js';
import type { HcmShotCompass } from '../../src/viewer/hcm-shot-compass.js';
import { defineKitDoubles } from './doubles.js';
import { readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { mountViewer, part } from './viewer-harness.js';

/** The shot direction button (scenario V93): under Show my location while the image on top has a shot direction. */
beforeAll(() => {
    defineKitDoubles();
    defineViewerElements();
});

type Raw = Record<string, unknown> & { layers: Record<string, unknown>[] };

/** The test manifest with the 1966 satellite image shot towards `degrees` (and, optionally, a kind). */
function shotManifest(degrees: number, kind?: string): ReturnType<typeof testManifest> {
    return testManifest((raw) => {
        const layer = (raw as Raw).layers.find((candidate) => candidate['id'] === 'kh4-1966');
        if (layer !== undefined) {
            layer['shotDirection'] = degrees;
            layer['kind'] = kind ?? layer['kind'];
        }
    });
}

describe('frontShotDirection', () => {
    it('happyPath_theImageOnTopGivesItsDirection @S-V93-HAPPY-TURN', () => {
        const manifest = shotManifest(135);
        const state = readyState(manifest, { year: 1966 });

        expect(frontShotDirection(manifest, state)).toBe(135);
        expect(frontShotDirection(manifest, { ...state, front: 'kh4-1966' })).toBe(135);
    });

    it('badPath_noneOnTodayOnADrawnMapOrBeforeTheManifest @S-V93-BAD-NO-DIRECTION', () => {
        const manifest = shotManifest(135);

        expect(frontShotDirection(manifest, readyState(manifest, { year: null }))).toBeNull();
        expect(frontShotDirection(shotManifest(135, 'map'), readyState(manifest, { year: 1966 }))).toBeNull();
        expect(frontShotDirection(testManifest(), readyState(testManifest(), { year: 1966 }))).toBeNull();
        expect(frontShotDirection(null, readyState(manifest, { year: 1966, front: 'gone' }))).toBeNull();
    });
});

describe('<hcm-map-viewer>: the shot direction button', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aClickTurnsTheMapToTheShotDirection @S-V93-HAPPY-TURN', async () => {
        const mounted = await mountViewer(readyState(shotManifest(135), { year: 1966, locale: 'en' }));
        const name = "Turn the map to the image's shot direction (135°)";

        await userEvent.click(page.getByRole('button', { name }));

        expect(mounted.store.callsOf('faceBearing')).toEqual([[135]]);
        expect(part(mounted, '.dock.shot hcm-shot-compass').getAttribute('title')).toBe(name);
        const control = mounted.element.shadowRoot?.querySelector('hcm-shot-compass');
        expect(control?.shadowRoot?.querySelector('hcm-icon')?.getAttribute('name')).toBe('satellite_alt');
        expect(part(mounted, '.dock.locate').classList.contains('over-shot')).toBe(true);
    });

    it('tracks camera rotation and describes its bearing', async () => {
        const mounted = await mountViewer(readyState(shotManifest(135), { year: 1966, locale: 'en' }));
        const control = mounted.element.shadowRoot?.querySelector<HcmShotCompass>('hcm-shot-compass');
        if (control === null || control === undefined) {
            throw new Error('shot control missing');
        }
        await control.updateComplete;
        const icon = control.shadowRoot?.querySelector<HTMLElement>('hcm-icon');
        expect(icon?.style.transform).toBe('rotate(135deg)');
        mounted.store.moveCamera({ bearing: 45, pitch: 0 });
        await control.updateComplete;
        expect(icon?.style.transform).toBe('rotate(90deg)');
        expect(control.shadowRoot?.querySelector('button')?.getAttribute('aria-describedby')).toBe('heading');
        expect(control.shadowRoot?.querySelector('#heading')?.textContent).toBe('The map is turned 45° from north.');
        mounted.store.moveCamera({ bearing: 135, pitch: 0 });
        await control.updateComplete;
        expect(icon?.style.transform).toBe('rotate(0deg)');
    });

    it('badPath_noShotDirectionNoButton @S-V93-BAD-NO-DIRECTION', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { year: 1966 }));

        expect(mounted.element.shadowRoot?.querySelector('.dock.shot')).toBeNull();
        expect(part(mounted, '.dock.locate').classList.contains('over-shot')).toBe(false);
    });

    it('badPath_aClickAfterTheImageLeftTheTopTurnsNothing', async () => {
        const mounted = await mountViewer(readyState(shotManifest(90), { year: 1966 }));
        const button = part(mounted, '.dock.shot hcm-shot-compass');
        mounted.store.set({ year: null });

        button.click();

        expect(mounted.store.callsOf('faceBearing')).toEqual([]);
    });
});
