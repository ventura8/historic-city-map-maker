/**
 * `wikipedia.manage` (`functions/src/wikipedia/manage.ts`, S-A230-*): the admin reads the defaults, saves the settings (other
 * languages ask for a fetch), asks for a refresh, and every write rebuilds the manifest; the tick asks for a build when due.
 */
import { DEFAULT_WIKIPEDIA_SETTINGS, FIRESTORE_PATHS, timestampFromDate, wikipediaStateDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { wikipediaFunctions } from '../../src/wikipedia/index.js';
import { manageWikipedia, manageWikipediaFunction } from '../../src/wikipedia/manage.js';
import { storeArticles } from '../../src/wikipedia/store.js';
import { wikipediaDue } from '../../src/wikipedia/tick.js';
import { CITY_ID } from '../publish/city.js';
import { adminCall, contentDeps } from '../publish/fakes.js';

const ADMIN = { uid: 'u-admin', email: undefined, claim: true } as const;
const NOW = '2026-11-22T08:00:00.000Z';
const PATH = FIRESTORE_PATHS.wikipedia(CITY_ID);
const AT = timestampFromDate(new Date('2026-11-21T08:00:00.000Z'));
const ARTICLE = {
    id: 'ro-1',
    lng: 26.1,
    lat: 44.4,
    versions: {
        ro: { title: 'Ateneul Român', extract: '', url: 'https://ro.wikipedia.org/wiki/A' },
        en: { title: 'Romanian Athenaeum', extract: '', url: 'https://en.wikipedia.org/wiki/A' },
    },
};

describe('manageWikipedia', () => {
    it('happyPath_getAnswersTheDefaultsBeforeTheFirstSave', async () => {
        const deps = contentDeps(NOW);

        await expect(manageWikipedia(deps, ADMIN, { cityId: CITY_ID, action: 'get' })).resolves.toEqual({
            settings: DEFAULT_WIKIPEDIA_SETTINGS,
            refreshRequested: false,
            articles: [],
        });
        expect(deps.tasks.queued).toEqual([]);
    });

    it('happyPath_getListsTheArticlesInTheFirstLanguageWithTheLastFetch', async () => {
        const deps = contentDeps(NOW);
        deps.documents.seed(PATH, {
            enabled: true,
            languages: ['en', 'ro'],
            hidden: [],
            articles: [ARTICLE],
            refreshedAt: AT,
            failure: 'rateLimited',
            updatedBy: 'u',
            updatedAt: AT,
        });

        await expect(manageWikipedia(deps, ADMIN, { cityId: CITY_ID, action: 'get' })).resolves.toMatchObject({
            articles: [{ id: 'ro-1', language: 'en', title: 'Romanian Athenaeum' }],
            refreshedAt: '2026-11-21T08:00:00.000Z',
            failure: 'rateLimited',
        });
    });

    it('happyPath_getListsTheStoredArticlesOverTheLegacyList', async () => {
        const deps = contentDeps(NOW);
        deps.documents.seed(PATH, { enabled: true, languages: ['ro'], hidden: [], articles: [], updatedBy: 'u', updatedAt: AT });
        await storeArticles(deps, CITY_ID, [ARTICLE]);

        await expect(manageWikipedia(deps, ADMIN, { cityId: CITY_ID, action: 'get' })).resolves.toMatchObject({
            articles: [{ id: 'ro-1', language: 'ro', title: 'Ateneul Român' }],
        });
    });

    it('happyPath_saveWritesTheSettingsAsksForAFetchAndRebuilds @S-A230-HAPPY-SAVE', async () => {
        const deps = contentDeps(NOW);
        const settings = { enabled: true, languages: ['ro', 'en'] as ('ro' | 'en')[], hidden: ['ro-9'] };

        await expect(manageWikipedia(deps, ADMIN, { cityId: CITY_ID, action: 'save', settings })).resolves.toMatchObject({ settings });
        await expect(deps.documents.get(PATH, wikipediaStateDocSchema)).resolves.toMatchObject({ ...settings, updatedBy: 'u-admin' });
        expect(deps.tasks.queued).toHaveLength(1);

        const first = await deps.documents.get(PATH, wikipediaStateDocSchema);
        deps.documents.seed(PATH, { ...first, refreshRequested: false });
        await manageWikipedia(deps, ADMIN, { cityId: CITY_ID, action: 'save', settings: { ...settings, hidden: [] } });
        await expect(deps.documents.get(PATH, wikipediaStateDocSchema)).resolves.toMatchObject({ refreshRequested: false });
        await manageWikipedia(deps, ADMIN, { cityId: CITY_ID, action: 'save', settings: { ...settings, languages: ['en'] } });
        await expect(deps.documents.get(PATH, wikipediaStateDocSchema)).resolves.toMatchObject({ refreshRequested: true });
    });

    it('happyPath_refreshAsksForAFetch', async () => {
        const deps = contentDeps(NOW);

        await expect(manageWikipedia(deps, ADMIN, { cityId: CITY_ID, action: 'refresh' })).resolves.toMatchObject({
            refreshRequested: true,
        });
        expect(deps.tasks.queued).toHaveLength(1);
    });

    it('badPath_anInvalidLanguageIsRefusedByTheCallable @S-A230-BAD-INVALID-SETTINGS', async () => {
        const callable = manageWikipediaFunction(() => contentDeps(NOW));
        await expect(
            callable.run(adminCall({ cityId: CITY_ID, action: 'save', settings: { enabled: true, languages: ['de'], hidden: [] } })),
        ).rejects.toMatchObject({ details: { code: 'apiError.invalidRequest' } });
        await expect(callable.run(adminCall({ cityId: CITY_ID, action: 'get' }))).resolves.toMatchObject({ refreshRequested: false });
    });

    it('happyPath_theGroupHasTheRegistryName', () => {
        expect(Object.keys(wikipediaFunctions(() => contentDeps(NOW)))).toEqual(['manage']);
    });
});

describe('wikipediaDue', () => {
    it('happyPath_aDueCityGetsABuild', async () => {
        const deps = contentDeps(NOW);
        deps.documents.seed(PATH, { enabled: true, languages: ['ro'], hidden: [], updatedBy: 'u', updatedAt: AT });

        await wikipediaDue(deps, CITY_ID, new Date(NOW));

        expect(deps.tasks.queued).toHaveLength(1);
    });

    it('badPath_anOffOrFreshCityGetsNone', async () => {
        const deps = contentDeps(NOW);
        await wikipediaDue(deps, CITY_ID, new Date(NOW));
        deps.documents.seed(PATH, { enabled: true, languages: ['ro'], hidden: [], refreshedAt: AT, updatedBy: 'u', updatedAt: AT });
        await wikipediaDue(deps, CITY_ID, new Date(NOW));

        expect(deps.tasks.queued).toEqual([]);
    });
});
