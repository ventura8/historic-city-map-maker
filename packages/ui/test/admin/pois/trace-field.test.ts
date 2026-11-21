// M27 "Disappeared streets" (S-A154): the place editor's "Traced on map" field and the old map's opacity.
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { HcmPoiEditor } from '../../../src/admin/pois/hcm-poi-editor.js';
import type { PlaceEditorPort, TraceLayerPort } from '../../../src/admin/pois/pois-port.js';
import { cleanup, deep, deepAll, deepText, defineAll, mount } from '../shell/fake-app.js';
import { area, CATEGORIES, draft, editor, VALUE, type PoisArea } from './fixtures.js';

const LAYERS: readonly TraceLayerPort[] = [
    { id: 'plan-1911', label: { ro: 'Planul Bucureștiului', en: 'The Bucharest plan' }, year: 1911 },
    { id: 'corona-1968', label: { ro: 'Corona 1968' }, year: 1968 },
];

async function mounted(
    port: PlaceEditorPort,
    locale: 'ro' | 'en' = 'en',
    readOnly = false,
): Promise<{ readonly element: HcmPoiEditor; readonly store: PoisArea }> {
    const store = area();
    const element = await mount<HcmPoiEditor>(
        html`<hcm-poi-editor
            .editor=${port}
            .categories=${CATEGORIES}
            .intents=${store.intents}
            .traceLayers=${LAYERS}
            .traceOpacity=${70}
            .locale=${locale}
            ?read-only=${readOnly}
        ></hcm-poi-editor>`,
        900,
    );
    return { element, store };
}

function traced(sourceLayer?: string): PlaceEditorPort {
    return editor({ draft: draft({ value: sourceLayer === undefined ? VALUE : { ...VALUE, sourceLayer } }) });
}

function choose(element: HTMLElement, value: string): void {
    const select = deep(element, '#trace-layer') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
}

function options(element: HTMLElement): string[] {
    return deepAll(element, '#trace-layer option').map((option) => option.textContent.trim());
}

describe('<hcm-poi-editor>: Traced on map', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theOldMapsAreOfferedByYearAndAChoiceEditsTheDraft @S-A154-HAPPY-TRACE', async () => {
        const { element, store } = await mounted(traced());

        expect(options(element)).toEqual(['None', 'The 1911 map — The Bucharest plan', 'The 1968 map — Corona 1968']);
        expect(deepText(element)).toContain('Traced on map');
        expect(deepAll(element, '#trace-opacity')).toEqual([]);
        choose(element, 'plan-1911');

        expect(store.named('edit')).toEqual(['edit {"sourceLayer":"plan-1911"}']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aChosenMapOffersItsOpacityAndClearingSendsNone', async () => {
        const { element, store } = await mounted(traced('corona-1968'), 'ro');

        expect((deep(element, '#trace-layer') as HTMLSelectElement).value).toBe('corona-1968');
        expect(options(element)[0]).toBe('Niciuna');
        expect(deepText(element)).toContain('Opacitatea hărții vechi');
        const slider = deep(element, '#trace-opacity') as HTMLInputElement;
        expect(slider.value).toBe('70');
        slider.value = '35';
        slider.dispatchEvent(new Event('input'));
        choose(element, '');

        expect(store.named('setTraceOpacity')).toEqual(['setTraceOpacity 35']);
        expect(store.named('edit')).toEqual(['edit {}']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aMapThatNoLongerExistsSaysSoAndAnotherCanBeChosen @S-A154-BAD-GONE-LAYER', async () => {
        const { element, store } = await mounted(traced('sters-1900'));

        expect(options(element)).toEqual([
            'None',
            'A map that no longer exists',
            'The 1911 map — The Bucharest plan',
            'The 1968 map — Corona 1968',
        ]);
        expect((deep(element, '#trace-layer') as HTMLSelectElement).value).toBe('sters-1900');
        expect(deep(element, '#trace-gone').textContent).toContain('was deleted or replaced');
        expect(deepAll(element, '#trace-opacity')).toEqual([]);
        choose(element, 'corona-1968');

        expect(store.named('edit')).toEqual(['edit {"sourceLayer":"corona-1968"}']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aRevokedAdminCannotChangeTheChoice', async () => {
        const { element } = await mounted(traced('plan-1911'), 'en', true);

        expect((deep(element, '#trace-layer') as HTMLSelectElement).disabled).toBe(true);
        expect((deep(element, '#trace-opacity') as HTMLInputElement).disabled).toBe(true);
    });
});
