/**
 * M20 §19.13: an archive series on the map or waiting for approval is offered **Fix the tiles** (`imagery.relayout`), a new version
 * reopened at its tile layout; the georeferencer of a series with no picture of its own says so and links the series.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryIntentsPort, ImageryViewState, VersionViewPort } from '../../../src/admin/imagery/imagery-port.js';
import type { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll } from '../shell/fake-app.js';
import {
    button,
    click,
    defineImagery,
    georefPage,
    georefState,
    georefVersion,
    imageryPage,
    imageryState,
    jobView,
    versionPage,
    versionView,
} from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'ar-mwgcdw8s-s-b250f2e03a5f' };

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

async function placedSeries(overrides: Partial<VersionViewPort>) {
    const done = jobView({ status: 'succeeded', finished: true, waitReason: null });
    const version = versionView({ state: 'published', origin: 'archive', relayoutable: true, ...overrides });
    return imageryPage(imageryState({ detail: VERSION, version: versionPage({}, version, done) }));
}

function offersFixTiles(element: HTMLElement): boolean {
    return deepAll(element, 'hcm-button').some((found) => found.textContent.includes('Fix the tiles'));
}

describe('imagery: Fix the tiles', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aPublishedSeriesOffersFixTheTiles @S-A-HAPPY-FIX-TILES', async () => {
        const { element, area } = await placedSeries({});

        click(button(element, 'Fix the tiles'));

        expect(calls(area)).toEqual(['fixTiles']);
        expect((await axeViolations(element)).join('\n')).toBe('');
    });

    it.each([
        ['not a series on the map', { relayoutable: false }],
        ['not said', { relayoutable: undefined }],
    ] as const)('badPath_noFixTheTilesFor_%s @S-A-BAD-FIX-TILES-STATE', async (_name, overrides) => {
        const { element } = await placedSeries(overrides as Partial<VersionViewPort>);

        expect(offersFixTiles(element)).toBe(false);
    });
});

describe('imagery: Redraw at full resolution', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    const placed = {
        method: 'gcps',
        transform: 'affine' as const,
        pairs: 8,
        fitRmseM: 3,
        checkpointRmseM: null,
        checkpointCount: null,
        checkpointKind: null,
    };

    it('happyPath_aSingleMapPlacedByPointsIsRedrawn @S-A16-HAPPY-REDRAW', async () => {
        const { element, area } = await placedSeries({ relayoutable: false, georef: placed });

        click(button(element, 'Redraw at full resolution'));

        expect(calls(area)).toEqual(['redraw']);
    });

    it.each([
        ['a series laid out by tiles', { georef: placed }],
        ['a join', { relayoutable: false, origin: 'join', georef: placed }],
        ['a file placed by itself', { relayoutable: false, georef: { ...placed, method: 'embedded' } }],
        ['no points', { relayoutable: false, georef: null }],
        ['a version not on the map', { relayoutable: false, state: 'rejected', georef: placed }],
    ] as const)('badPath_noRedrawFor_%s @S-A16-BAD-REDRAW', async (_name, overrides) => {
        const { element } = await placedSeries(overrides);

        expect(deepAll(element, 'hcm-button').some((found) => found.textContent.includes('Redraw at full resolution'))).toBe(false);
    });
});

describe('the georeferencer of an archive series', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_itsJoinedSheetsAreShownToCheckWithTheWayToFixTheTiles @S-A-HAPPY-FIX-TILES', async () => {
        const version = georefVersion({ id: VERSION.id, editable: false, series: { stitchedOnly: true } });
        const { element } = await georefPage(georefState({ versionId: VERSION.id, version, pairs: [] }));

        const note = deep(element, '[data-state="stitched-only"]');
        expect(note.textContent).toContain('no points here');
        expect(note.querySelector('a')?.getAttribute('href')).toBe(`#/imagery/version/${VERSION.id}`);
        expect(deep(element, 'hcm-scan-viewer')).toBeDefined();
    });

    it('badPath_aSeriesWithNoPictureSaysWhyInsteadOfTheScanCannotBeShown @S-A-BAD-FIX-TILES-STATE', async () => {
        const version = georefVersion({ id: VERSION.id, editable: false, scan: null, series: { stitchedOnly: false } });
        const { element } = await georefPage(georefState({ versionId: VERSION.id, version, pairs: [] }));

        expect(deep(element, '[data-state="no-scan-series"]').textContent).toContain('Fix the tiles');
        expect(deepAll(element, '[data-state="no-scan"]')).toHaveLength(0);
    });
});
