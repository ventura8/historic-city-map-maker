/**
 * An archive series waiting with `layout-check` (`docs/research/M20-import-local.md` §19.11): its page links the tile-import wizard
 * (`#/help/<versionId>/tiles`) and not the georeferencer (its scan is the doubtful preview, §19.11); any other version has no wizard link.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanup, deepAll } from '../shell/fake-app.js';
import { defineImagery, imageryPage, imageryState, versionPage, versionView } from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };

async function links(layoutCheck: boolean): Promise<string[]> {
    const view = versionView({ state: 'needs_gcps', origin: 'archive', georef: null, output: null, layoutCheck });
    const { element } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, view) }));
    return deepAll(element, 'a').map((link) => link.getAttribute('href') ?? '');
}

describe('the tile-import wizard from a version @S-A-HAPPY-TILE-WIZARD-ORDER', () => {
    beforeAll(async () => {
        await defineImagery();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_aSeriesWaitingForItsTilesLinksTheWizard', async () => {
        expect(await links(true)).toContain('#/help/job-1966/tiles');
    });

    it('badPath_anyOtherVersionHasNoLink', async () => {
        expect(await links(false)).not.toContain('#/help/job-1966/tiles');
    });

    it('badPath_aSeriesWhoseTilesWaitOffersNoPointsOnItsPreview @S-A-BAD-TILE-WIZARD-POINTS-FIRST', async () => {
        expect(await links(true)).not.toContain('#/georef/job-1966');
        expect(await links(false)).toContain('#/georef/job-1966');
    });
});
