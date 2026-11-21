// Edit points on a version the map shows (S-A16-HAPPY-EDIT-POINTS-PUBLISHED): its page offers **Edit points**, and the georeferencer
// says that saving makes a new version while the map keeps this one; a version that takes no points offers neither
// (S-A16-BAD-EDIT-POINTS-ENDED).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
    defineImagery,
    georefPage,
    georefState,
    georefVersion,
    imageryPage,
    imageryState,
    versionPage,
    versionView,
} from '../imagery/fixtures.js';
import { cleanup, deep, deepAll } from '../shell/fake-app.js';

const NOTE = '[data-state="published-note"]';

describe('edit points after a version is on the map', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aPublishedVersionOffersEditPointsAndTheGeoreferencerSaysWhatSavingDoes @S-A16-HAPPY-EDIT-POINTS-PUBLISHED', async () => {
        const page = await imageryPage(
            imageryState({
                detail: { kind: 'version' as const, id: 'job-1966' },
                version: versionPage({}, versionView({ state: 'published' })),
            }),
        );
        const link = deep(page.element, 'a[data-action="edit-points"]');
        expect([link.getAttribute('href'), link.textContent.trim()]).toEqual(['#/georef/job-1966', 'Edit points']);
        cleanup();

        const georef = await georefPage(georefState({ version: georefVersion({ state: 'published' }) }));
        expect(deep(georef.element, NOTE).textContent.trim()).toBe(
            'This version is on the map. Saving makes a new version; this one stays until you approve it.',
        );
        // The pairs are there to edit: each row's Delete and Add pairs are on.
        expect(deepAll(georef.element, '[data-state="read-only"]')).toEqual([]);
        cleanup();

        const ro = await georefPage(georefState({ version: georefVersion({ state: 'published' }) }), { locale: 'ro' });
        expect(deep(ro.element, NOTE).textContent).toContain('Versiunea este pe hartă.');
    });

    it('badPath_aVersionWaitingForPointsOrOneThatEndedSaysNothingAboutANewVersion @S-A16-BAD-EDIT-POINTS-ENDED', async () => {
        const waiting = await imageryPage(
            imageryState({
                detail: { kind: 'version' as const, id: 'job-1966' },
                version: versionPage({}, versionView({ state: 'needs_gcps' })),
            }),
        );
        expect(deepAll(waiting.element, 'a[data-action="edit-points"]')).toEqual([]);
        expect(deep(waiting.element, 'a[data-action="open-georef"]').textContent.trim()).toBe('Open the georeferencer');
        cleanup();

        const ended = await imageryPage(
            imageryState({
                detail: { kind: 'version' as const, id: 'job-1966' },
                version: versionPage({}, versionView({ state: 'superseded' })),
            }),
        );
        expect(deepAll(ended.element, 'a[href="#/georef/job-1966"]')).toEqual([]);
        cleanup();

        const first = await georefPage(georefState({ version: georefVersion({ state: 'needs_gcps' }) }));
        expect(deepAll(first.element, NOTE)).toEqual([]);
        cleanup();
        // Superseded: it takes no points, and says only that.
        const old = await georefPage(georefState({ version: georefVersion({ state: 'superseded', editable: false }) }));
        expect(deepAll(old.element, NOTE)).toEqual([]);
        expect(deepAll(old.element, '[data-state="read-only"]')).toHaveLength(1);
    });
});
