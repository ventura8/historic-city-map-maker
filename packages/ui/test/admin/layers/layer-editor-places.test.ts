/** The layer editor's place picker and level (`layer-editor.ts`, M17 §12 and §14), rendered on its own. */
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { layerEditor, type EditorContext } from '../../../src/admin/layers/layer-editor.js';
import type { LayersIntentsPort, LayersViewState } from '../../../src/admin/layers/layers-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, defineAll, mount, updated } from '../shell/fake-app.js';
import { editorOf, layerDoc, layersState } from './fixtures.js';

function context(overrides: Partial<EditorContext>): EditorContext {
    return {
        locale: 'en',
        intents: null,
        announce: () => undefined,
        listHref: '#/layers',
        deleted: () => undefined,
        map: { status: 'none', css: '' },
        readOnly: false,
        who: { self: 'u1', people: {} },
        crop: null,
        assist: null,
        ...overrides,
    };
}

async function editor(overrides: Partial<EditorContext>): Promise<HTMLElement> {
    const element = await mount<HTMLElement>(
        html`<div>${layerEditor(context(overrides), editorOf(layerDoc({ placeIds: ['p1'] })), { phase: 'idle' })}</div>`,
    );
    await customElements.whenDefined('hcm-shot-direction');
    await element.querySelector('hcm-shot-direction')?.updateComplete;
    await updated(element);
    return element;
}

function change(element: HTMLElement, selector: string, value: string): void {
    const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (field === null) {
        throw new Error(`no ${selector}`);
    }
    field.value = value;
    field.dispatchEvent(new Event('change'));
}

describe('the layer editor: places and level', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aPlacePickedAndALevelTypedAreEdits @S-A199-HAPPY-LAYER-PLACES', async () => {
        const store = new FakeArea<LayersViewState, LayersIntentsPort>(layersState());
        const places = [
            { id: 'p1', title: { ro: 'Parcul Carol' } },
            { id: 'p2', title: { ro: 'Cișmigiu' } },
        ];
        const element = await editor({ intents: store.intents, places });

        change(element, '#layer-places', 'p2');
        element.querySelector<HTMLElement>('.place-links hcm-button')?.dispatchEvent(new Event('click'));
        change(element, '#layer-level-order', '0');
        change(element, '#layer-level-label', 'Parter');

        expect(store.calls.filter((call) => !call.startsWith('attachMap'))).toEqual([
            'edit {"placeIds":["p1","p2"]}',
            'edit {}',
            'edit {}',
            'edit {"level":{"order":0,"label":{"ro":"Parter"}}}',
        ]);
    });

    it('badPath_withoutPlacesIntentsOrAssistNoPickerNoDraftAndNothingWrites @S-A199-BAD-LAYER-PLACES', async () => {
        const element = await editor({});

        expect(element.querySelector('#layer-places')).toBeNull();
        change(element, '#layer-level-order', '1');
        expect(element.querySelector('#layer-level-order')).not.toBeNull();
    });

    it('happyPath_theShotDirectionTypedIsAnEdit @S-A233-HAPPY-SHOT-DIAL', async () => {
        const store = new FakeArea<LayersViewState, LayersIntentsPort>(layersState());
        const element = await editor({ intents: store.intents });

        change(element, '#layer-shot-degrees', '90');
        change(element, '#layer-shot-degrees', '');

        expect(store.calls.filter((call) => call.startsWith('edit'))).toEqual(['edit {"shotDirection":90}', 'edit {}']);
    });

    it('badPath_withoutIntentsTheShotDirectionWritesNothing @S-A233-BAD-SHOT-DIAL', async () => {
        const element = await editor({});

        change(element, '#layer-shot-degrees', '90');
        expect(element.querySelector('hcm-direction-dial')).not.toBeNull();
    });
});
