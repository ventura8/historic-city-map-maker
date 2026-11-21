// The list of what the map pane shows (S-A16-HAPPY-GEOREF-MAP-SHOWS): OpenStreetMap, Sentinel-2 and the city's published layers, a
// native list with a label; with one reference and no layer there is nothing to choose (S-A16-BAD-GEOREF-MAP-SHOWS-GONE).
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defineImagery, georefPage, georefReference, georefState, georefVersion } from '../imagery/fixtures.js';
import { cleanup, deep, deepAll } from '../shell/fake-app.js';

const LAYERS = [
    { id: 'plan-1911', label: { ro: 'Planul 1911', en: 'The 1911 plan' }, year: 1911 },
    { id: 'corona-1968', label: { ro: 'Corona 1968' }, year: 1968 },
];

function choose(element: HTMLElement, value: string): void {
    const select = deep(element, 'select#map-shows') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
}

describe('the list of what the map pane shows', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theListOffersTheReferencesAndThePublishedLayersAndSaysWhichIsShown @S-A16-HAPPY-GEOREF-MAP-SHOWS', async () => {
        const { element, area } = await georefPage(georefState({ baseLayers: LAYERS, reference: 'osm' }));
        const select = deep(element, 'select#map-shows') as HTMLSelectElement;

        expect(deep(element, 'label[for="map-shows"]').textContent.trim()).toBe('The map shows');
        expect([...select.options].map((option) => [option.value, option.textContent.trim()])).toEqual([
            ['reference:osm', 'OpenStreetMap'],
            ['reference:s2', 'Sentinel-2'],
            ['layer:plan-1911', 'The 1911 plan (1911)'],
            ['layer:corona-1968', 'Corona 1968 (1968)'],
        ]);
        expect(select.value).toBe('reference:osm');

        choose(element, 'layer:plan-1911');
        choose(element, 'reference:s2');
        choose(element, 'layer:nowhere');
        expect(area.calls.filter((call) => call.startsWith('setBase') || call.startsWith('setReference'))).toEqual([
            'setBase "plan-1911"',
            'setBase null',
            'setReference "s2"',
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aLayerShownIsSelectedAndCreditedInRomanian @S-A16-HAPPY-GEOREF-MAP-SHOWS', async () => {
        const { element } = await georefPage(georefState({ baseLayers: LAYERS, base: 'plan-1911' }), { locale: 'ro' });

        expect((deep(element, 'select#map-shows') as HTMLSelectElement).value).toBe('layer:plan-1911');
        expect(deep(element, 'label[for="map-shows"]').textContent.trim()).toBe('Harta arată');
        expect(deep(element, '.map-pane').textContent).toContain('Sub perechi: stratul publicat Planul 1911 (1911).');
    });

    it('badPath_withOneReferenceAndNoPublishedLayerThereIsNothingToChoose @S-A16-BAD-GEOREF-MAP-SHOWS-GONE', async () => {
        const version = georefVersion({ reference: georefReference({ s2Path: null }) });
        const { element } = await georefPage(georefState({ version, baseLayers: [] }));

        expect(deepAll(element, 'select#map-shows')).toEqual([]);
        // A layer id the list no longer has: the reference's credit, not a layer's.
        cleanup();
        const gone = await georefPage(georefState({ baseLayers: LAYERS, base: 'nowhere', reference: 'osm' }));
        expect(deep(gone.element, '.map-pane').textContent).toContain('OpenStreetMap contributors');
    });

    it('badPath_theListDoesNotPushTheMapBelowTheScan @S-A122-BAD-GEOREF-PANES-MISALIGNED', async () => {
        const { element } = await georefPage(georefState({ baseLayers: LAYERS, reference: 'osm' }));
        const box = (selector: string): DOMRect => deep(element, selector).getBoundingClientRect();

        // The owner's report of 2026-11-13: the list sat above the map only, 80 px of offset (lesson 668).
        expect(box('select#map-shows').height).toBeGreaterThan(0);
        expect(Math.abs(box('.scan-pane hcm-scan-viewer').top - box('.map-pane hcm-admin-map').top)).toBeLessThanOrEqual(1);
        expect(Math.abs(box('.scan-pane hcm-scan-viewer').height - box('.map-pane hcm-admin-map').height)).toBeLessThanOrEqual(1);
        expect(Math.abs(box('.scan-pane .turn').top - box('.map-pane .turn').top)).toBeLessThanOrEqual(1);
    });
});
