/**
 * A scene's usefulness on its page and card (`packages/ui/src/admin/imagery/scene-unusable.ts`; the owner's report of 2026-11-13):
 * Not useful with why in one click, the mark and Undo, the card's chips, and the warning of a frame probably cloudy over the city
 * before an import or a purchase.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanup, deep, deepAll, updated } from '../shell/fake-app.js';
import { click, defineImagery, imageryPage, imageryState, scene } from './fixtures.js';

const SCENE = { kind: 'scene' as const, id: 'DS1035-1057DA023' };

function withScene(overrides: Parameters<typeof scene>[0]) {
    const item = scene(overrides);
    return imageryState({ detail: SCENE, visible: [item], scenes: { ...imageryState().scenes, items: [item] } });
}

describe('<hcm-imagery-page>: Not useful', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aReasonIsOneClick @S-A152-HAPPY', async () => {
        const { element, area } = await imageryPage(
            withScene({}),
            { params: ['scene', SCENE.id] },
            { markUnusable: Promise.resolve(true) },
        );

        const section = deep(element, '[data-scene-unusable]');
        expect(deep(section, 'h3').textContent).toBe('Not useful?');
        expect(deepAll(section, 'hcm-button').map((target) => target.textContent.replace(/\s+/g, ' ').trim())).toEqual([
            'Not useful: Clouds',
            'Not useful: Haze or blur',
            'Not useful: Wrong area',
            'Not useful: Other',
        ]);
        click(deep(section, '[data-unusable="clouds"]'));
        await updated(element);

        expect(area.calls).toContain('markUnusable "DS1035-1057DA023" "clouds"');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aMarkedSceneSaysWhatItDidAndOffersUndo @S-A152-HAPPY-UNDO', async () => {
        const { element, area } = await imageryPage(
            withScene({ status: 'rejected', unusable: 'clouds' }),
            { params: ['scene', SCENE.id] },
            { markUnusable: Promise.resolve(true) },
        );

        const section = deep(element, '[data-scene-unusable]');
        expect(deep(section, '[data-state="unusable-marked"]').textContent).toContain('You marked this scan not useful (Clouds):');
        click(deep(section, 'hcm-button'));
        await updated(element);

        expect(area.calls).toContain('markUnusable "DS1035-1057DA023" null');
        expect(deep(element, '[data-state="unusable"]').textContent.trim()).toBe('Not useful');
    });

    it('badPath_aCloudyFrameWarnsOnItsPageAndCard @S-A152-BAD-CLOUDY', async () => {
        const { element } = await imageryPage(withScene({ cloudCity: 46, free: false }), { params: ['scene', SCENE.id] });

        const warning = deep(element, '[data-state="cloudy-warning"]');
        expect(warning.textContent).toContain('Probably cloudy over the city: 46 %');
        expect(warning.textContent).toContain('Look at the preview before you import or buy it.');
        expect(deep(element, '[data-state="cloudy"]').textContent.trim()).toBe('Probably cloudy over the city: 46 %');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aClearFrameAnImportedOneAndARefusal', async () => {
        const { element, area } = await imageryPage(withScene({ cloudCity: 12 }), { params: ['scene', SCENE.id] });
        const clear = deepAll(element, '[data-state="cloudy-warning"], [data-state="cloudy"]').length;
        area.set({ orderRefusal: { id: SCENE.id, notice: { key: 'apiError.imagery.alreadyImported' }, action: 'unusable' } });
        await updated(element);
        const refused = deep(element, '[data-scene-unusable] .alert').getAttribute('role');
        const imported = scene({ status: 'imported', layerId: 'kh-4a-1966' });
        area.set({ scenes: { ...imageryState().scenes, items: [imported] }, visible: [imported] });
        await updated(element);

        expect(clear).toBe(0);
        expect(refused).toBe('alert');
        expect(deepAll(element, '[data-scene-unusable]')).toHaveLength(0);
    });
});
