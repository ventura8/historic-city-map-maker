/**
 * The assists' slots inside the photo and place editors (`docs/research/M4-interfaces.md` §4.1, CR-M4-4): Suggest a
 * title under the title, a suggestion that fills the title, the draft button beside a pair with text on one side, and no
 * slot at all for an editor without assists; the layer editor has the draft buttons only. The intents go to the area;
 * nothing is saved here.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AssistViewPort } from '../../../src/admin/assist/assist-port.js';
import type { LayersIntentsPort, LayersViewState } from '../../../src/admin/layers/layers-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { editorOf as layerEditor, layerDoc, layersState, page as layersPage } from '../layers/fixtures.js';
import { cleanup, deep, deepAll, defineAll, mount, updated } from '../shell/fake-app.js';
import { area as photosArea, editor as photoEditor, photosState, VALUE as PHOTO } from '../photos/fixtures.js';
import { area as poisArea, CATEGORIES, draft, editor as placeEditor, VALUE as PLACE } from '../pois/fixtures.js';

const READY: AssistViewPort = {
    titles: { status: 'ready', suggestions: [{ ro: 'Ateneul Român', en: 'Romanian Athenaeum' }], attribution: 'x', error: null },
    drafts: {},
};

function slots(element: HTMLElement): readonly (string | null)[] {
    return deepAll(element, '[data-assist]').map((slot) => slot.getAttribute('data-assist'));
}

function press(element: HTMLElement, selector: string): void {
    deep(deep(element, selector), 'button').click();
}

describe('the photo editor assists', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_suggestATitleASuggestionAndTheDraftButtonsAskTheArea', async () => {
        const value = { ...PHOTO, description: { ro: '', en: 'A street.' } };
        const photos = photosArea(photosState({ editor: photoEditor({ value }) }));
        const element = await mount<HTMLElement>(
            html`<hcm-admin-photo-editor
                .editor=${photoEditor({ value })}
                .intents=${photos.intents}
                .assist=${READY}
                .locale=${'en'}
            ></hcm-admin-photo-editor>`,
            900,
        );
        await updated(element);

        expect(slots(element)).toEqual(['title', 'draft-title', 'draft-description']);
        press(element, '[data-assist="title"] .actions');
        press(element, '[data-assist-suggestions]');
        press(element, '[data-assist="draft-title"] .actions');
        press(element, '[data-assist="draft-description"] .actions');

        expect(photos.calls.filter((call) => /^(suggestTitle|useTitle|draftText)/.test(call))).toEqual([
            'suggestTitle',
            'useTitle 0',
            'draftText "title" "en"',
            'draftText "description" "ro"',
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anEditorWithoutAssistsHasNoSlot', async () => {
        const photos = photosArea();
        const element = await mount<HTMLElement>(
            html`<hcm-admin-photo-editor .editor=${photoEditor()} .intents=${photos.intents} .locale=${'en'}></hcm-admin-photo-editor>`,
            900,
        );
        await updated(element);

        expect(slots(element)).toEqual([]);
    });
});

describe('the place editor assists', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    async function placeOf(assist: AssistViewPort | null, value = PLACE): Promise<{ element: HTMLElement; calls: () => string[] }> {
        const store = poisArea();
        const element = await mount<HTMLElement>(
            html`<hcm-poi-editor
                .editor=${placeEditor({ draft: draft({ value }) })}
                .categories=${CATEGORIES}
                .photos=${[]}
                .intents=${store.intents}
                .assist=${assist}
                .locale=${'ro'}
            ></hcm-poi-editor>`,
            900,
        );
        await updated(element);
        return { element, calls: () => store.calls.filter((call) => /^(suggestTitle|useTitle|draftText)/.test(call)) };
    }

    it('happyPath_theTitleSlotAndTheDescriptionsDraftAskTheArea', async () => {
        const { element, calls } = await placeOf(READY, { ...PLACE, title: { ro: 'Stavropoleos' }, description: { ro: 'Biserica.' } });

        expect(slots(element)).toEqual(['title', 'draft-title', 'draft-description']);
        press(element, '[data-assist-suggestions]');
        press(element, '[data-assist="draft-description"] .actions');

        expect(calls()).toEqual(['useTitle 0', 'draftText "description" "en"']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_noAssistsOrNoTextOffersNoDraft', async () => {
        const without = await placeOf(null);
        expect(slots(without.element)).toEqual([]);
        cleanup();

        const empty = await placeOf(READY, { ...PLACE, title: { ro: '' } });
        expect(slots(empty.element)).toEqual(['title']);
    });
});

describe('the layer editor assists', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theNameAndTheDescriptionHaveDraftButtonsAndNoTitleSlot', async () => {
        const layer = layerDoc({ label: { ro: 'Corona 1968' }, description: { ro: '', en: 'A spy photo.' } });
        const working: AssistViewPort = {
            ...READY,
            drafts: { 'label.en': { status: 'working', model: null, truncated: false, error: null } },
        };
        const layers = new FakeArea<LayersViewState, LayersIntentsPort>(layersState({ editor: layerEditor(layer), assist: working }), {});
        const { element } = await layersPage('layers', layers, { params: ['corona'] });

        expect(slots(element)).toEqual(['draft-label', 'draft-description']);
        expect(deep(deep(element, '[data-assist="draft-label"] .actions'), 'hcm-button').hasAttribute('disabled')).toBe(true);
        press(element, '[data-assist="draft-description"] .actions');

        expect(layers.calls.filter((call) => call.startsWith('draftText'))).toEqual(['draftText "description" "ro"']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aLayerNamedInBothLanguagesIsOfferedNoDraftThatWouldReplaceOne', async () => {
        const layers = new FakeArea<LayersViewState, LayersIntentsPort>(layersState({ editor: layerEditor(layerDoc()) }), {});
        const { element } = await layersPage('layers', layers, { params: ['corona'] });

        expect(slots(element)).toEqual([]);
    });

    it('badPath_aRevokedAdminsLayerOffersNoWorkingDraft', async () => {
        const named = layerDoc({ label: { ro: 'Corona 1968' } });
        const layers = new FakeArea<LayersViewState, LayersIntentsPort>(layersState({ editor: layerEditor(named) }), {});
        const { element } = await layersPage('layers', layers, { params: ['corona'], revoked: true });

        expect(slots(element)).toEqual(['draft-label']);
        expect(deep(deep(element, '[data-assist="draft-label"] .actions'), 'hcm-button').hasAttribute('disabled')).toBe(true);
    });
});
