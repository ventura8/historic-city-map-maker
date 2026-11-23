/**
 * 2026-11-23 (LESSONS 791): a single map placed by points is offered **Redraw at full resolution** on its version page, its own
 * points warped again from the original as a new version; a join, a series laid out by tiles, a file placed by itself, a map
 * with no points or one not on the map is not.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryIntentsPort, ImageryViewState, VersionViewPort } from '../../../src/admin/imagery/imagery-port.js';
import type { FakeArea } from '../editing/fake-area.js';
import { cleanup, deepAll } from '../shell/fake-app.js';
import { button, click, defineImagery, imageryPage, imageryState, jobView, versionPage, versionView } from '../imagery/fixtures.js';

const VERSION = { kind: 'version' as const, id: 'ar-mwqvwxms-s-96641a19cd8d' };

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

async function placedSeries(overrides: Partial<VersionViewPort>) {
    const done = jobView({ status: 'succeeded', finished: true, waitReason: null });
    const version = versionView({ state: 'published', origin: 'archive', relayoutable: true, ...overrides });
    return imageryPage(imageryState({ detail: VERSION, version: versionPage({}, version, done) }));
}

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
