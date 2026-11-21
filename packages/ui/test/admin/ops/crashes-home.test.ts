import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CrashesIntentsPort, CrashesViewState } from '../../../src/admin/crashes/crashes-port.js';
import { errorGroupUrl, releaseUrl } from '../../../src/admin/crashes/hcm-crashes-list-page.js';
import { publicMapText } from '../../../src/admin/home/hcm-home-page.js';
import type { HomeIntentsPort, HomeViewState } from '../../../src/admin/home/home-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { crashesState, homeState, page } from './fixtures.js';

describe('<hcm-crashes-list-page>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theGroupsOfAPeriodAndTheSelectedGroupsDetailWithTheConsoleLink', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({ selected: 'g1', nextPageToken: 'next' }));
        const { element } = await page('crashes', crashes);

        const rows = deepAll(element, 'button.row');
        expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual(['true', 'false']);
        expect(rows[0]?.textContent).toContain('TypeError: <b>x</b> is undefined');
        expect(deepAll(element, 'b')).toHaveLength(0);
        expect(deep(element, 'h2[data-detail-heading]').textContent).toBe('TypeError: <b>x</b> is undefined');
        expect(deepText(deep(element, '.facts'))).toContain('1,234');
        expect(deepText(deep(element, '.facts'))).toContain('admin 1.2.3');
        expect(deepText(deep(element, '.facts'))).toContain('Firefox 145 mobile');
        expect(deepText(deep(element, '.facts'))).toContain('https://demo-hcm.web.app/admin/');
        expect(deepAll(element, 'ol.frames li').map((item) => item.textContent)).toEqual([
            'at draw (https://demo-hcm.web.app/admin/assets/index.js:10:5)',
            'at <b>run</b> (index.js:2:1)',
        ]);
        expect(deep(element, 'a[href*="github.com"]').textContent).toContain('Release notes of 1.2.3');
        const link = deep(element, 'a[href*="console.cloud.google.com"]');
        expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual([
            'https://console.cloud.google.com/errors/detail/g1?project=demo-hcm',
            '_blank',
            'noopener noreferrer',
        ]);
        rows[1]?.click();
        deep(deep(element, '.more'), 'hcm-button').click();
        expect(crashes.calls.filter((call) => !call.startsWith('open'))).toEqual(['select "g2"', 'more']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anotherPeriodAndThePhonesClose', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({ selected: 'g2' }));
        const { element } = await page('crashes', crashes, { width: 360 });

        expect(deepText(deep(element, '.facts'))).toContain('viewer');
        expect(deepText(element)).toContain('The browser sent no stack for this error');
        expect(deepAll(element, 'a[href*="github.com"]')).toHaveLength(0);
        deep(deep(element, 'hcm-list-detail'), '.back hcm-button').click();
        deep(element, 'hcm-segmented-button').dispatchEvent(new CustomEvent('hcm-change', { detail: { value: '24' } }));

        expect(crashes.calls.filter((call) => !call.startsWith('open'))).toEqual(['select null', 'setPeriod 24']);
    });

    it('badPath_aDisabledApiIsExplainedWithTheWayToSetupAndOtherFailuresOfferTryAgain', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(
            crashesState({
                status: 'error',
                groups: [],
                apiDisabled: true,
                failure: { key: 'apiError.cloud.apiDisabled', params: { api: 'clouderrorreporting.googleapis.com' } },
            }),
        );
        const { element } = await page('crashes', crashes);
        expect(deep(element, '[role="alert"]').textContent).toContain('clouderrorreporting.googleapis.com');
        expect(deep(element, 'a[href="#/setup/analytics"]').textContent).toBe('Open the analytics setup');
        deep(element, '.pane .actions hcm-button').click();

        crashes.set({ apiDisabled: false, failure: { key: 'apiError.errorReporting.unavailable' } });
        await updated(element);
        expect(deepAll(element, 'a[href="#/setup/analytics"]')).toHaveLength(0);
        crashes.set({ status: 'loading', failure: null });
        await updated(element);
        expect(deepAll(element, 'hcm-loading-indicator')).toHaveLength(1);
        crashes.set({ status: 'ready' });
        await updated(element);

        expect(deepText(element)).toContain('No errors reported in this period.');
        expect(crashes.named('retry')).toEqual(['retry']);
        expect(releaseUrl('1.0.0-beta.1')).toBe('https://github.com/ventura8/historic-city-map-maker/releases/tag/v1.0.0-beta.1');
        expect([releaseUrl('abc123'), releaseUrl(undefined)]).toEqual([null, null]);
        expect(errorGroupUrl('a b', 'C/1')).toBe('https://console.cloud.google.com/errors/detail/C%2F1?project=a%20b');
    });
});

describe('<hcm-home-page>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    // M18 item 7 (docs/research/M18-improvements.md): What needs you, each a link to where it is done.
    it('happyPath_whatNeedsYouListsWhatWaitsForAPersonWithItsLink @S-A40-HAPPY-STORIES-TO-REVIEW', async () => {
        const counts = {
            ...homeState().counts,
            versionsToApprove: 1,
            roleRequests: 2,
            suggestionsToReview: 3,
            photosToReview: 6,
            placesToReview: 7,
            storiesToReview: 5,
            failedJobs: 4,
        } as HomeViewState['counts'];
        const { element } = await page(
            'home',
            new FakeArea<HomeViewState, HomeIntentsPort>(homeState({ counts }), { refresh: Promise.resolve() }),
        );

        const needs = deepAll(element, 'section[aria-labelledby="adminShell.home.needsYou"] a.tile').map((tile) => [
            tile.getAttribute('href'),
            tile.textContent.replace(/\s+/g, ' ').trim(),
        ]);
        expect(needs).toEqual([
            ['#/imagery', '1 Historical images to approve'],
            ['#/review', '2 Role requests to accept'],
            ['#/review', '3 Suggestions to review'],
            ['#/review', '6 Photos to review'],
            ['#/review', '7 Places to review'],
            ['#/review', '5 Stories to review'],
            ['#/jobs', '4 Failed jobs'],
        ]);
    });

    it('badPath_nothingWaitingSaysSo', async () => {
        const counts = { ...homeState().counts, versionsToApprove: 0, failedJobs: 0 } as HomeViewState['counts'];
        const { element } = await page(
            'home',
            new FakeArea<HomeViewState, HomeIntentsPort>(homeState({ counts }), { refresh: Promise.resolve() }),
        );

        expect(deepAll(element, 'section[aria-labelledby="adminShell.home.needsYou"] a')).toHaveLength(0);
        expect(deepText(element)).toContain('Nothing needs you now.');
        expect((await axeViolations(element)).join('\n')).toBe('');
    });

    it('happyPath_theCountsWhatWaitsTheServicesAndThePublicMap', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(homeState(), { refresh: Promise.resolve() });
        const { element } = await page('home', home);

        const tiles = deepAll(element, 'a.tile').map((tile) => [
            tile.getAttribute('href'),
            tile.textContent.replace(/\s+/g, ' ').trim(),
            tile.hasAttribute('data-attention'),
        ]);
        expect(tiles).toEqual([
            // M18 item 7: What needs you lists what waits for a person now, and a count not read keeps its dash.
            ['#/imagery', '2 Historical images to approve', true],
            ['#/jobs', '— Failed jobs', false],
            ['#/photos', '45 Photos', false],
            ['#/pois', '3 Places', false],
            ['#/settings/categories', '2 Place categories', false],
            ['#/layers', '0 Historical layers', false],
            ['#/photos', '4 Photos to check for rights', true],
            ['#/photos', '0 Unpublished photos', false],
            ['#/jobs', '1 Jobs running', true],
            ['#/imagery', '0 Scans waiting for georeferencing points', false],
        ]);
        expect(deepAll(element, 'li.tag').map((chip) => [chip.dataset['tone'], chip.textContent.trim()])).toEqual([
            ['good', 'Billing: working'],
            ['good', 'Google Cloud: working'],
            ['error', 'Mapbox: needs attention (Mapbox refused the token: it is invalid or has been revoked.)'],
            ['wait', 'USGS: waiting'],
            ['none', 'Analytics: not set up'],
            ['error', 'Crash reports: not answering'],
        ]);
        expect(deepText(element)).toContain('The public map is up to date');
        expect(deepText(element)).toContain('Items not on the public map: 3');
        // Not on the public map: each document with its first issue, a link to its editor (S-A38-BAD-SKIPPED-SHOWN).
        expect(
            deepAll(element, 'ul.skipped li').map((item) => [item.querySelector('a')?.getAttribute('href'), item.textContent.trim()]),
        ).toEqual([
            ['#/layers/corona-1968', expect.stringMatching(/^Layer corona-1968 · Attribution: /)],
            ['#/settings/categories/piete', expect.stringMatching(/^Category piete · /)],
            ['#/stories/teatrul', expect.stringMatching(/teatrul · /)],
        ]);
        deep(element, '.pane > .actions hcm-button').click();
        expect(home.named('refresh')).toEqual(['refresh']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_countingAFailedServiceListenerAndThePublicMapsStates', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(
            homeState({
                countsStatus: 'loading',
                counts: null,
                health: { status: 'error', chips: [], reconnecting: false },
                publicMap: { status: 'loading', doc: null, reconnecting: true, failure: null },
            }),
        );
        const { element } = await page('home', home, { locale: 'ro' });

        expect(deep(element, 'a.tile .value').textContent).toBe('…');
        expect(deepText(element)).toContain('Se încarcă…');
        expect(deepAll(element, '[role="status"]').map((status) => status.textContent.trim())).toContain('Se reconectează…');
        deep(element, 'section .pane .actions hcm-button').click();
        expect(home.named('retry')).toEqual(['retry']);

        expect(publicMapText('en', null)).toBe('The public map has not been published yet.');
        expect(publicMapText('en', { status: 'building', builtAt: null, skipped: [], error: null })).toBe('Updating the public map…');
        expect(publicMapText('en', { status: 'failed', builtAt: null, skipped: [], error: { key: 'apiError.internal' } })).toContain(
            'The last update of the public map failed: ',
        );
    });
});

describe('<hcm-home-page>: What needs you while a count is unknown', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    // Review of M18 item 7: a count not read is no zero; it keeps its tile with a dash, never "Nothing needs you now.".
    it('badPath_aCountNotReadKeepsItsTileWithADash_andTheFirstOpenSaysNothingYet', async () => {
        const counts = { ...homeState().counts, versionsToApprove: 0, roleRequests: null } as HomeViewState['counts'];
        const failed = await page(
            'home',
            new FakeArea<HomeViewState, HomeIntentsPort>(homeState({ counts, countsStatus: 'error' }), { refresh: Promise.resolve() }),
        );
        const needsOf = (element: HTMLElement): string[] =>
            deepAll(element, 'section[aria-labelledby="adminShell.home.needsYou"] a.tile').map((tile) =>
                tile.textContent.replace(/\s+/g, ' ').trim(),
            );
        expect(needsOf(failed.element)).toEqual(['— Role requests to accept', '— Failed jobs']);
        expect(deepText(failed.element)).not.toContain('Nothing needs you now.');
        cleanup();

        const loading = await page(
            'home',
            new FakeArea<HomeViewState, HomeIntentsPort>(homeState({ countsStatus: 'loading', counts: null })),
        );
        expect(needsOf(loading.element)).toEqual([
            '… Historical images to approve',
            '… Role requests to accept',
            '… Suggestions to review',
            '… Photos to review',
            '… Places to review',
            '… Stories to review',
            '… Failed jobs',
        ]);
        expect(deepText(loading.element)).not.toContain('Nothing needs you now.');
    });
});
