/**
 * M20 (DECISIONS-for-review.md §216): a placed archive series with pieces left out of its overview mosaic is offered Locate again,
 * which lays it on its overview again in a new version of the same layer (`imagery.locateAgain`, `functions/src/imagery/restitch.ts`).
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryIntentsPort, ImageryViewState, VersionViewPort } from '../../../src/admin/imagery/imagery-port.js';
import type { FakeArea } from '../editing/fake-area.js';
import { cleanup, deepAll } from '../shell/fake-app.js';
import { button, click, defineImagery, imageryPage, imageryState, jobView, versionPage, versionView } from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };
const PAIRS = {
    method: 'gcps',
    transform: 'tps',
    pairs: 6,
    fitRmseM: 3,
    checkpointRmseM: 22.5,
    checkpointCount: 6,
    checkpointKind: 'leave-one-out',
} as const;

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && call !== 'close');
}

async function placedSeries(overrides: Partial<VersionViewPort>) {
    const done = jobView({ status: 'succeeded', finished: true, waitReason: null });
    const version = versionView({ state: 'published', origin: 'archive', georef: PAIRS, restitchable: true, ...overrides });
    return imageryPage(imageryState({ detail: VERSION, version: versionPage({}, version, done) }));
}

function offersLocateAgain(element: HTMLElement): boolean {
    return deepAll(element, 'hcm-button').some((found) => found.textContent.includes('Locate again'));
}

describe('imagery: a placed series with pieces left out of its overview mosaic', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aPlacedSeriesWithPiecesLeftOutOffersLocateAgain @S-A122-HAPPY-RESTITCH', async () => {
        const { element, area } = await placedSeries({});

        click(button(element, 'Locate again'));

        expect(calls(area)).toEqual(['locateAgain']);
        expect((await axeViolations(element)).join('\n')).toBe('');
    });

    it.each([
        ['not stitched again', { restitchable: false }],
        ['not said', { restitchable: undefined }],
    ] as const)('badPath_noLocateAgainFor_%s @S-A122-BAD-RESTITCH-NOTHING-LEFT', async (_name, overrides) => {
        const { element } = await placedSeries(overrides as Partial<VersionViewPort>);

        expect(offersLocateAgain(element)).toBe(false);
    });
});
