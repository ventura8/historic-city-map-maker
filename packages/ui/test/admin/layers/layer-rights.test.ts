import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { LayersIntentsPort, LayersViewState } from '../../../src/admin/layers/layers-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, defineAll } from '../shell/fake-app.js';
import { draftOf, editorOf, layerDoc, layersState, page } from './fixtures.js';

/** A drawn map's licence and author in the layer editor (behaviour A197; the owner, 2026-11-22). */
function area(state: LayersViewState): FakeArea<LayersViewState, LayersIntentsPort> {
    return new FakeArea<LayersViewState, LayersIntentsPort>(state, {
        save: Promise.resolve({ ok: true }),
        move: Promise.resolve(null),
        moveTo: Promise.resolve(null),
        confirmDelete: Promise.resolve(true),
        submitLink: Promise.resolve(null),
    });
}

const DRAWN = layerDoc({ kind: 'map', rights: { licence: 'permission', author: 'Ion Ionescu' } });

describe('<hcm-layers-page> rights', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theLicenceAndAuthorShowAndEditTheirFields', async () => {
        const layers = area(layersState({ editor: editorOf(DRAWN) }));
        const { element } = await page('layers', layers, { params: ['corona'] });

        const select = deep(element, '#layer-rights-licence') as HTMLSelectElement;
        expect(select.value).toBe('permission');
        expect(deepAll(element, '#layer-rights-licence option').map((option) => option.textContent.trim())).toContain('Public domain');
        expect((deep(element, '#layer-rights-author') as HTMLInputElement).value).toBe('Ion Ionescu');
        select.value = 'PD';
        select.dispatchEvent(new Event('change'));

        expect(layers.named('setField')).toEqual(['setField "rights.licence" "PD"']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([
        ['en', 'Rights unclear'],
        ['ro', 'Drepturi neclare'],
    ] as const)('happyPath_anEditorCanSelectUnclearRightsIn%s', async (locale, label) => {
        const layers = area(layersState({ editor: editorOf(DRAWN) }));
        const { element } = await page('layers', layers, { params: ['corona'], locale });
        const select = deep(element, '#layer-rights-licence') as HTMLSelectElement;

        select.value = 'unclear';
        expect(select.selectedOptions[0]?.textContent.trim()).toBe(label);
        select.dispatchEvent(new Event('change'));
        expect(layers.named('setField')).toEqual(['setField "rights.licence" "unclear"']);
    });

    it('happyPath_aLayerWithoutRightsShowsNotSetAndNoAuthor', async () => {
        const { element } = await page('layers', area(layersState({ editor: editorOf(layerDoc()) })), { params: ['corona'], locale: 'ro' });

        expect((deep(element, '#layer-rights-licence') as HTMLSelectElement).value).toBe('');
        expect(deepAll(element, '#layer-rights-author')).toEqual([]);
    });

    it('happyPath_unclearRightsShowThePlainNote @S-A197-HAPPY-UNCLEAR', async () => {
        // The owner, 2026-11-24: rights not confirmed; ask the scan source for permission.
        const unclear = layerDoc({ kind: 'map', rights: { licence: 'unclear', author: 'Ion Ionescu' } });
        const { element } = await page('layers', area(layersState({ editor: editorOf(unclear) })), { params: ['corona'], locale: 'ro' });

        expect((deep(element, '#layer-rights-licence') as HTMLSelectElement).value).toBe('unclear');
        expect(deep(element, '#layer-rights-unclear').textContent).toContain('Cere sursei scanării permisiunea de publicare');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aConfirmedLicenceShowsNoUnclearNote @S-A197-BAD-UNCLEAR-MISSPELT', async () => {
        const { element } = await page('layers', area(layersState({ editor: editorOf(DRAWN) })), { params: ['corona'] });

        expect(deepAll(element, '#layer-rights-unclear')).toEqual([]);
    });
    it('badPath_aLongAuthorIsMarkedAtItsField', async () => {
        const issues = [{ path: 'rights.author', code: 'validation.tooBig' }] as const;
        const layers = area(layersState({ editor: editorOf(DRAWN, { draft: draftOf(DRAWN, { issues }) }) }));
        const { element } = await page('layers', layers, { params: ['corona'] });

        expect(deep(element, '#layer-rights-author').getAttribute('aria-invalid')).toBe('true');
    });

    it('badPath_aRevokedAdminCannotChangeTheLicence', async () => {
        const { element } = await page('layers', area(layersState({ editor: editorOf(DRAWN) })), { params: ['corona'], revoked: true });

        expect((deep(element, '#layer-rights-licence') as HTMLSelectElement).disabled).toBe(true);
    });
});
