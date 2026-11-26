/** The stories area's store (M17, `docs/research/M17-stories.md` §6; A100): the list, New story, the editor, Delete, the pickers. */
import { FIRESTORE_PATHS } from '@hcm/shared';
import type { AreaPort, StoriesIntentsPort, StoriesViewState } from '@hcm/ui/admin';
import { describe, expect, it } from 'vitest';

import type { ContentServices } from '../../src/content/services.js';
import { newStory, storiesQuery, storyIssues } from '../../src/stories/model.js';
import { STORIES_MODULE } from '../../src/stories/stories.js';
import { CITY, contentWorld } from '../content/world.js';
import { settle } from '../photos/world.js';

const STAMP = { updatedBy: 'u', updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 } };
const STORY = { title: { ro: 'Teatrul' }, body: { ro: 'A ars în 1944.' }, yearStart: 1852, published: true, createdBy: 'u', ...STAMP };

type Assignable<Source, Target> = [Source] extends [Target] ? true : false;
const STORE_SATISFIES_PORT: Assignable<ReturnType<typeof STORIES_MODULE.create>, AreaPort<StoriesViewState, StoriesIntentsPort>> = true;

function world(overrides: Partial<ContentServices> = {}) {
    const made = contentWorld(overrides);
    made.store.put(FIRESTORE_PATHS.story(CITY, 's1'), STORY);
    made.store.put(FIRESTORE_PATHS.story(CITY, 'w1'), {
        ...STORY,
        title: { ro: 'În așteptare' },
        published: false,
        reviewStatus: 'pending',
    });
    made.store.put(FIRESTORE_PATHS.photo(CITY, 'p1'), {
        title: { ro: 'Fațada' },
        license: 'PD',
        published: true,
        processing: 'done',
        ...STAMP,
    });
    return { ...made, area: STORIES_MODULE.create(made.services) };
}

describe('the stories area @S-A100-HAPPY-EDIT', () => {
    it('happyPath_listsTheStoriesWithTheirState', async () => {
        const w = world();
        w.area.open([]);
        await settle();
        expect([STORE_SATISFIES_PORT]).toEqual([true]);
        expect(w.area.state.reviewer).toBe(true);
        expect(w.area.state.list.items.map((item) => [item.id, item.published, item.review])).toEqual([
            ['s1', true, null],
            ['w1', false, 'pending'],
        ]);
    });

    it('happyPath_aNewStoryIsCreatedUnpublishedAndOpens', async () => {
        const w = world();
        w.area.open([]);
        const id = await w.area.intents.create('  Hanul cu Tei ');
        expect(id).toBe('new-1');
        expect(w.store.docs.get(FIRESTORE_PATHS.story(CITY, 'new-1'))).toMatchObject({
            title: { ro: 'Hanul cu Tei' },
            published: false,
            createdBy: 'admin-uid',
        });
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.stories.created' });
    });

    it('happyPath_editSaveAndDelete', async () => {
        const w = world();
        w.area.open(['s1']);
        await settle();
        w.area.intents.edit({ body: { ro: 'Altfel.', en: 'Otherwise.' }, poiIds: ['enei'] });
        expect(w.area.hasUnsavedChanges()).toBe(true);
        expect(await w.area.intents.save()).toEqual({ ok: true });
        expect(w.store.docs.get(FIRESTORE_PATHS.story(CITY, 's1'))).toMatchObject({
            body: { ro: 'Altfel.', en: 'Otherwise.' },
            poiIds: ['enei'],
        });
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.stories.saved' });
        await settle();
        expect(await w.area.intents.remove()).toEqual({ ok: true });
        expect(w.store.docs.has(FIRESTORE_PATHS.story(CITY, 's1'))).toBe(false);
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.stories.deleted' });
    });

    it('happyPath_thePickersReadTheCitysPhotosAndPlacesOnce', async () => {
        const w = world();
        w.area.open(['s1']);
        w.area.intents.loadPicks();
        w.area.intents.loadPicks();
        await settle();
        expect(w.area.state.picks).toEqual({ photos: [{ id: 'p1', title: { ro: 'Fațada' } }], places: [] });
    });

    it('happyPath_conflictDiscardRetryAndClose', async () => {
        const w = world();
        w.area.open(['s1']);
        await settle();
        w.area.intents.edit({ title: { ro: 'Al meu' } });
        w.store.put(FIRESTORE_PATHS.story(CITY, 's1'), {
            ...STORY,
            title: { ro: 'Al lor' },
            updatedAt: { seconds: 1_700_000_100, nanoseconds: 0 },
        });
        await settle();
        expect(w.area.state.open?.draft.conflict?.fields).toEqual(['title']);
        w.area.intents.takeTheirs();
        expect(w.area.state.open?.draft.value?.title).toEqual({ ro: 'Al lor' });
        w.area.intents.edit({ title: { ro: 'Iar al meu' } });
        w.area.intents.keepMine();
        w.area.intents.discard();
        expect(w.area.hasUnsavedChanges()).toBe(false);
        w.area.intents.more();
        w.area.intents.retry();
        w.area.close();
        expect(w.area.state.open).toBeNull();
        w.area.destroy();
    });
});

describe('the stories area: refusals', () => {
    it('badPath_anHttpLinkKeepsSaveOffAndSaysWhere', async () => {
        const w = world();
        w.area.open(['s1']);
        await settle();
        w.area.intents.edit({ body: { ro: 'O [sursă](http://example.org).' } });
        expect(w.area.state.open?.draft.issues).toEqual([{ path: 'body.ro', code: 'validation.markdownLink' }]);
        expect(await w.area.intents.save()).toMatchObject({ ok: false, reason: 'invalid' });
        expect(w.notices).toEqual([]);
    });

    it('badPath_aBlankTitleCreatesNothing', async () => {
        const w = world();
        expect(await w.area.intents.create('   ')).toBeNull();
        expect(w.store.writes).toEqual([]);
    });

    it('badPath_anUnknownIdSaysNotFoundAndOfflineWritesSaySo', async () => {
        const w = world();
        w.area.open(['gone']);
        await settle();
        expect(w.area.state.open).toMatchObject({ id: 'gone', doc: { status: 'ready', doc: null } });
        expect(await w.area.intents.remove()).toBeNull();
        w.store.setOffline(true);
        expect(await w.area.intents.create('Nouă')).toBeNull();
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.common.offline' });
    });

    it('badPath_anUploadersStoryWaitsAndTheirListIsTheirOwn', async () => {
        const w = world({ cityRole: () => 'uploader' });
        w.area.open([]);
        await settle();
        expect(w.area.state.reviewer).toBe(false);
        expect(w.area.state.role).toBe('uploader');
        expect(await w.area.intents.create('A mea')).toBe('new-1');
        expect(w.store.docs.get(FIRESTORE_PATHS.story(CITY, 'new-1'))).toMatchObject({ reviewStatus: 'pending', published: false });
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.stories.createdPending' });
        w.store.uid = null;
        expect(await w.area.intents.create('Alta')).toBeNull();
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.common.denied' });
    });
});

describe('the stories model', () => {
    it('happyPath_queryIssuesAndPublishing', () => {
        expect(storiesQuery(null)).toEqual({ orderBy: [['updatedAt', 'desc']] });
        expect(storiesQuery('u1')).toEqual({ where: [['createdBy', '==', 'u1']] });
        expect(newStory('A', false)).toEqual({ title: { ro: 'A' }, published: false });
        expect(storyIssues({ ...STORY, body: undefined })).toEqual([{ path: 'body.ro', code: 'validation.required' }]);
        expect(storyIssues(STORY)).toEqual([]);
    });
});

describe('the stories area: its edges', () => {
    it('badPath_nothingOpenSavesNothingAndABadIdOpensNoDraft', async () => {
        const w = world();
        expect(await w.area.intents.save()).toBeNull();
        w.area.intents.edit({ title: { ro: 'x' } });
        w.area.intents.keepMine();
        w.area.open(['bad id!']);
        await settle();
        expect(w.area.state.open?.draft.value).toBeNull();
        expect(await w.area.intents.remove()).toBeNull();
    });

    it('badPath_pickersThatCannotBeReadAreEmptyAndADeniedListSaysSo', async () => {
        const w = world({ cityRole: () => 'uploader' });
        w.area.open(['s1']);
        w.store.fail(FIRESTORE_PATHS.photos(CITY), { kind: 'denied', code: 'permission-denied' });
        w.area.intents.loadPicks();
        w.store.fail(FIRESTORE_PATHS.photos(CITY), { kind: 'denied', code: 'permission-denied' });
        w.store.fail(FIRESTORE_PATHS.pois(CITY), { kind: 'denied', code: 'permission-denied' });
        await settle();
        expect(w.area.state.picks).toEqual({ photos: [], places: [] });
        w.store.fail(FIRESTORE_PATHS.stories(CITY), { kind: 'denied', code: 'permission-denied' });
        expect(w.denials.count).toBeGreaterThan(0);
    });

    it('badPath_anOfflineSaveSaysSoAndAConflictAsksForNames', async () => {
        const w = world();
        w.area.open(['s1']);
        await settle();
        w.area.intents.edit({ title: { ro: 'Al meu' } });
        w.store.setOffline(true);
        expect(await w.area.intents.save()).toMatchObject({ ok: false, reason: 'offline' });
        expect(w.notices.at(-1)).toEqual({ key: 'adminContent.common.offline' });
        w.store.setOffline(false);
        w.store.put(FIRESTORE_PATHS.story(CITY, 's1'), {
            ...STORY,
            title: { ro: 'Al lor' },
            updatedAt: { seconds: 1_700_000_200, nanoseconds: 0 },
        });
        await settle();
        expect(w.peopleAsked.count).toBeGreaterThan(0);
    });
});
