import { describe, expect, it } from 'vitest';

import { layoutFor } from '../../src/viewer/layout.js';

describe('layoutFor', () => {
    it('happyPath_compactUsesBottomSheetsAndAFullScreenAbout', () => {
        expect(layoutFor('compact', false)).toEqual({
            sheetMode: 'bottom',
            layersDocked: false,
            timeline: 'vertical',
            aboutFullscreen: true,
        });
    });

    it('happyPath_mediumUsesModalSideSheets', () => {
        expect(layoutFor('medium', false)).toMatchObject({ sheetMode: 'side', layersDocked: false, aboutFullscreen: false });
    });

    it('happyPath_aMediumWindowFrom760PxDocksOneSupportingPane', () => {
        // The Pixel Tablet upright (800 px, 2026-11-12): the modal side sheets covered the timeline, Menu and zoom.
        expect(layoutFor('medium', false, true)).toEqual(layoutFor('expanded', false));
        expect(layoutFor('medium', false, false)).toMatchObject({ sheetMode: 'side' });
    });

    it('badPath_aShortWideWindowKeepsModalSideSheets', () => {
        expect(layoutFor('medium', true, true)).toMatchObject({ sheetMode: 'side', aboutFullscreen: true });
        expect(layoutFor('compact', false, true)).toMatchObject({ sheetMode: 'bottom' });
    });

    it('happyPath_expandedAndLargeDockOneSupportingPane', () => {
        expect(layoutFor('expanded', false)).toMatchObject({ sheetMode: 'docked', layersDocked: false });
        expect(layoutFor('large', false)).toMatchObject({ sheetMode: 'docked', layersDocked: false });
    });

    it('happyPath_extraLargeDocksTheLayersPanelToo', () => {
        expect(layoutFor('extra-large', false)).toMatchObject({ sheetMode: 'docked', layersDocked: true });
    });

    it('badPath_compactHeightWinsOverAnyWidth', () => {
        for (const windowClass of ['compact', 'medium', 'expanded', 'extra-large'] as const) {
            expect(layoutFor(windowClass, true)).toEqual({
                sheetMode: 'side',
                layersDocked: false,
                timeline: 'horizontal',
                aboutFullscreen: true,
            });
        }
    });
});
