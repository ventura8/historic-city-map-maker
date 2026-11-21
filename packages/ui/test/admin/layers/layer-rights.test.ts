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

    it('happyPath_aLayerWithoutRightsShowsNotSetAndNoAuthor', async () => {
        const { element } = await page('layers', area(layersState({ editor: editorOf(layerDoc()) })), { params: ['corona'], locale: 'ro' });

        expect((deep(element, '#layer-rights-licence') as HTMLSelectElement).value).toBe('');
        expect(deepAll(element, '#layer-rights-author')).toEqual([]);
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
