import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { LAYER_GEOMETRY_ELEMENTS } from '../../../src/admin/areas/layer-geometry.js';
import type { CropStatePort } from '../../../src/admin/layers/geometry/crop-port.js';
import type { LayersIntentsPort, LayersViewState } from '../../../src/admin/layers/layers-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { editorOf, layerDoc, layersState, page } from './fixtures.js';

function area(state: LayersViewState): FakeArea<LayersViewState, LayersIntentsPort> {
    return new FakeArea<LayersViewState, LayersIntentsPort>(state, { crop: Promise.resolve(), saveCrop: Promise.resolve(true) });
}

function calls(store: FakeArea<LayersViewState, LayersIntentsPort>): readonly string[] {
    return store.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap'));
}

function group(element: HTMLElement): HTMLElement {
    return deep(element, '[data-group="geometry"]');
}

/** The `hcm-button` of `root` whose label is `text`, clicked. */
function press(root: HTMLElement, text: string): void {
    const found = deepAll(root, 'hcm-button').find((candidate) => candidate.textContent.trim() === text);
    deep(found ?? root, 'button').click();
}

const PROCESSED = layerDoc({ currentVersion: 'corona-v1', pendingVersion: 'corona-v2' });

function crop(overrides: Partial<CropStatePort> = {}): CropStatePort {
    return { phase: 'drawing', vertices: 2, refusal: null, ...overrides };
}

describe('<hcm-layers-page>: the image and geometry tools', () => {
    beforeAll(() => {
        defineAll();
        LAYER_GEOMETRY_ELEMENTS.define(customElements);
    });
    afterEach(cleanup);

    it('happyPath_replaceGeoreferenceAgainCropAndThePendingVersion', async () => {
        const layers = area(layersState({ editor: editorOf(PROCESSED) }));
        const { element } = await page('layers', layers, { params: ['corona'] });

        const links = deepAll(group(element), 'a').map((link) => [link.getAttribute('href'), link.textContent.trim()]);
        press(group(element), 'Crop');

        expect(links).toEqual([
            ['#/imagery/version/corona-v2', 'A new version is under way: open it'],
            ['#/imagery/replace/corona', 'Replace the image'],
            ['#/georef/corona-v1', 'Edit points'],
        ]);
        expect(calls(layers)).toEqual(['crop']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aLinkedLayerHasNoScanToGeoreferenceOrCrop', async () => {
        const { element } = await page('layers', area(layersState({ editor: editorOf(layerDoc()) })), { params: ['corona'] });

        expect(deep(group(element), '[data-state="no-scan"]').textContent).toContain('it has no scan to georeference or crop');
        expect(deepAll(group(element), 'hcm-button')).toHaveLength(0);
        expect(deepAll(group(element), 'a').map((link) => link.getAttribute('href'))).toEqual(['#/imagery/replace/corona']);
    });

    it('badPath_aJoinedLayerOffersNeitherGeoreferenceAgainNorCrop_andSaysWhatToDo', async () => {
        const joined = layerDoc({ currentVersion: 'corona-v1', provenance: { usgsParts: ['F039', 'F040'] } });
        const { element } = await page('layers', area(layersState({ editor: editorOf(joined) })), { params: ['corona'] });

        expect(deep(group(element), '[data-state="joined-layer"]').textContent).toContain('delete it and join them again');
        expect(deepAll(group(element), 'hcm-button')).toHaveLength(0);
        expect(deepAll(group(element), 'a').map((link) => link.getAttribute('href'))).toEqual(['#/imagery/replace/corona']);
    });

    it('happyPath_aLayerTheJoinOfItsDateReplacedSaysSoAndLinksTheJoin @S-A65-HAPPY-PUBLISHED-FRAMES', async () => {
        const retired = layerDoc({
            currentVersion: 'corona-v1',
            published: false,
            retired: { by: 'jn-1', at: { seconds: 1, nanoseconds: 0 } },
        });
        const { element } = await page('layers', area(layersState({ editor: editorOf(retired) })), { params: ['corona'] });
        const note = deep(group(element), '[data-state="retired-layer"] a');

        expect(note.getAttribute('href')).toBe('#/imagery/version/jn-1');
        expect(note.textContent).toContain('Replaced by the joined layer of its date');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aLayerNoJoinReplacedHasNoRetiredNote', async () => {
        const { element } = await page('layers', area(layersState({ editor: editorOf(layerDoc()) })), { params: ['corona'] });

        expect(deepAll(group(element), '[data-state="retired-layer"]')).toEqual([]);
    });

    it('happyPath_theCropSaysWhatToDoAndItsButtonsCallTheirIntents', async () => {
        const layers = area(layersState({ editor: editorOf(PROCESSED), crop: crop() }));
        const { element } = await page('layers', layers, { params: ['corona'] });
        const tool = deep(element, 'hcm-layer-crop');
        const drawing = [deepText(tool), (deepAll(tool, 'hcm-button')[0] as HTMLElement & { disabled: boolean }).disabled];

        press(tool, "Add a corner at the map's centre");
        press(tool, 'Draw again');
        layers.set({ crop: crop({ phase: 'drawn', vertices: 4 }) });
        await updated(element);
        await updated(tool);
        press(tool, 'Save the crop');
        press(tool, 'Cancel');

        expect(drawing[0]).toContain('Corners: 2.');
        expect(drawing[1]).toBe(true);
        expect(deepText(tool)).toContain('The area to keep has 4 corners.');
        expect(calls(layers)).toEqual(['addCropCorner', 'redrawCrop', 'saveCrop', 'closeCrop']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aRefusedCropTheToolsLoadingNoMapAndAReadOnlyAdmin', async () => {
        const refused = crop({ phase: 'drawn', vertices: 4, refusal: { key: 'apiError.imagery.cropOutsideLayer' } });
        const layers = area(layersState({ editor: editorOf(PROCESSED), crop: refused }));
        const { element } = await page('layers', layers, { params: ['corona'], revoked: true });
        const tool = deep(element, 'hcm-layer-crop');
        const alert = deep(tool, '[role="alert"]').textContent;
        const save = (deepAll(tool, 'hcm-button')[0] as HTMLElement & { disabled: boolean }).disabled;
        const texts: string[] = [];
        for (const phase of ['loading', 'saving', 'no-map'] as const) {
            layers.set({ crop: crop({ phase }) });
            await updated(element);
            await updated(tool);
            texts.push(deep(tool, '[role="status"]').textContent);
        }

        expect(alert).toContain('The crop polygon does not touch the layer.');
        expect(save).toBe(true);
        expect(texts).toEqual([
            'Loading the drawing tools…',
            'Sending the crop…',
            'The map is not available: there is nothing to draw on.',
        ]);
    });

    it('happyPath_aCropElementWithoutItsStateShowsNothingAndWithoutItsIntentsDoesNothing', async () => {
        const element = document.createElement('hcm-layer-crop');
        document.body.append(element);
        await updated(element);
        const empty = element.shadowRoot?.textContent.trim();
        (element as HTMLElement & { view: CropStatePort }).view = crop();
        LAYER_GEOMETRY_ELEMENTS.define(customElements);
        await updated(element);
        press(element, 'Anulează');

        expect(empty).toBe('');
        expect(deepText(element)).toContain('Colțuri: 2.');
        element.remove();
    });
});
