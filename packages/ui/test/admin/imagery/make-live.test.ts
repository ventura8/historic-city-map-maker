/**
 * Make this version the live one on the version page (S-A231-*; lesson 759): offered for a superseded version whose own tiles are still
 * public, asked first, then `makeLive`; a superseded version whose tiles are gone says so and names Calibrate again; any other version
 * offers neither.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { VersionViewPort } from '../../../src/admin/imagery/imagery-port.js';
import { cleanup, deep, deepAll, updated } from '../shell/fake-app.js';
import { button, click, defineImagery, imageryPage, imageryState, jobView, versionPage, versionView } from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };
const LABEL = 'Make this version the live one';
const DONE = jobView({ status: 'succeeded', finished: true, waitReason: null, progress: null });
const PUBLIC = 'https://storage.example/public/tiles/bucharest/l/job-1966.pmtiles';

function shown(version: Partial<VersionViewPort>) {
    return imageryState({ detail: VERSION, version: versionPage({}, versionView({ georef: null, ...version }), DONE) });
}

function liveButtons(element: HTMLElement): HTMLElement[] {
    return deepAll(element, 'hcm-button').filter((candidate) => candidate.textContent.trim() === LABEL);
}

describe('<hcm-imagery-page>: Make this version the live one', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aSupersededVersionIsMadeLiveAfterTheQuestion @S-A231-HAPPY-MAKE-LIVE', async () => {
        const { element, area } = await imageryPage(shown({ state: 'superseded', publicUrl: PUBLIC }), { params: ['version', VERSION.id] });

        click(button(element, LABEL));
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { headline: string; body: string; confirmLabel: string };
        expect(dialog.headline).toBe('Put this version back on the map?');
        expect(dialog.body).toContain('can come back');
        expect(dialog.confirmLabel).toBe(LABEL);
        expect(await axeViolations(element)).toEqual([]);
        click(deep(dialog, '.confirm'));
        await updated(element);

        expect(area.calls).toContain('makeLive');
    });

    it('badPath_tilesGoneSaysSoAndNamesCalibrateAgain @S-A231-BAD-TILES-GONE', async () => {
        const { element } = await imageryPage(shown({ state: 'superseded', publicUrl: null }), { params: ['version', VERSION.id] });

        expect(liveButtons(element)).toEqual([]);
        const note = deep(element, '.tiles-gone');
        expect(note.textContent).toContain('Its tiles were removed');
        expect(note.textContent).toContain('Calibrate again');
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each<[VersionViewPort['state']]>([['published'], ['rejected'], ['awaiting_approval']])(
        'badPath_a%sVersionOffersNoMakeLive @S-A231-BAD-TILES-GONE',
        async (state) => {
            const { element } = await imageryPage(shown({ state, publicUrl: PUBLIC }), { params: ['version', VERSION.id] });

            expect(liveButtons(element)).toEqual([]);
            expect(deepAll(element, '.tiles-gone')).toEqual([]);
        },
    );
});
