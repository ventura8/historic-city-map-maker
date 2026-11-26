import type { Page, Route } from '@playwright/test';

import type { EmulatorWorld } from '../support/emulators.js';
import { setupText } from '../support/i18n.js';
import { FIRST_PHOTOS, countUploads, importCard, imported, legacyPhotos } from '../support/legacy-import.js';
import { seedClaimedCity, seedSetupStatus } from '../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The old site's 2023 additions (docs/research/M5-interfaces.md → The 2023 additions; behaviour A28): the bundle grew
 * from the 45 photos of `seed/bucharest/` to 57 with the 12 of `seed/bucharest-2023/`. A map that has the first photos
 * is offered the missing ones in one click and gets only them; no run undoes what the owner did to an imported photo
 * (the import reads each photo's history, which outlives a delete).
 *
 * Directions from the old site (docs/research/M5-interfaces.md → Directions from the old site): the old site later moved
 * Parc Ferdinand and gave it a cone (`seed/bucharest-2023/corrections.json`). A map that has the photo as first migrated
 * (no direction) gets the old site's in one click, and the credits name the additions' author; the owner's own direction
 * or place is never overwritten.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

test.beforeEach(async ({ adminWorld }) => {
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
});

/** A record of the bundle's `photos.json` (`migrateLegacyPhotos`), as far as these tests read it. */
interface BundleRecord {
    readonly sourceFile: string;
    readonly photo: { readonly id: string };
}

/**
 * Serves the page the bundle's `photos.json` cut by `take` (the real file, fetched from the admin's server): the bundle as
 * it was before the 2023 additions, then as it is, with a few photos of each so the emulators process them in seconds.
 */
async function serveBundle(page: Page, take: (records: readonly BundleRecord[]) => readonly BundleRecord[]): Promise<void> {
    await page.route('**/legacy/bucharest/photos.json', async (route: Route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: take((await response.json()) as BundleRecord[]) });
    });
}

/** Three of the first photos, and with `added` two of the 2023 additions after them. */
function firstAnd(added: boolean): (records: readonly BundleRecord[]) => readonly BundleRecord[] {
    return (records) => [...records.slice(0, 3), ...(added ? records.slice(FIRST_PHOTOS, FIRST_PHOTOS + 2) : [])];
}

/** The photo documents of `ids`, as the emulators hold them (undefined for a deleted one). */
async function photoDocs(emulators: EmulatorWorld, ids: readonly string[]): Promise<Record<string, unknown>[]> {
    const photos = await emulators.collection('cities/bucharest/photos');
    return ids.map((id) => photos[id] ?? { id, gone: true });
}

test(
    "A map that has the first photos is offered the old site's additions, imports only them, and a second run adds nothing",
    { tag: ['@S-A28-HAPPY-ADDITIONS'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(420_000);
        let records: readonly BundleRecord[] = [];
        await serveBundle(page, (all) => {
            records = all;
            return firstAnd(false)(all);
        });
        const first = await importCard(page, lang, 3);
        await first.action.click();
        await imported(page, lang, 3);
        const firstIds = records.slice(0, 3).map((record) => record.photo.id);
        const before = await photoDocs(adminWorld.emulators, firstIds);

        // The bundle now has the additions: the card says what the map lacks, and that the photos on it stay as they are.
        const later = await page.context().newPage();
        await serveBundle(later, firstAnd(true));
        const uploads = countUploads(later);
        const { card } = await importCard(later, lang, 5);
        await expect(card.getByText(setupText(lang, 'adminSetup.import.missing', { count: '2' }))).toBeVisible();
        await card.getByRole('button', { name: setupText(lang, 'adminSetup.import.actionMissing', { count: '2' }), exact: true }).click();
        await imported(later, lang, 5);

        expect(uploads()).toBe(2);
        expect(await photoDocs(adminWorld.emulators, firstIds)).toEqual(before);
        const addedIds = records.slice(FIRST_PHOTOS, FIRST_PHOTOS + 2).map((record) => record.photo.id);
        expect(await photoDocs(adminWorld.emulators, addedIds)).toEqual(
            addedIds.map(
                () =>
                    expect.objectContaining({
                        published: true,
                        processing: 'done',
                        rightsReview: true,
                        license: 'permission-legacy',
                    }) as unknown,
            ),
        );
        const photos = await legacyPhotos(adminWorld.emulators);
        expect(photos).toHaveLength(5);

        // Opened again, the card has nothing left to import (a run from a tab opened before: S-A28-BAD-OWNER-EDITS-KEPT).
        await later.close();
        const again = await page.context().newPage();
        await serveBundle(again, firstAnd(true));
        const { card: done } = await importCard(again, lang, 5);
        await expect(done.getByText(setupText(lang, 'adminSetup.import.done', { count: '5' }))).toBeVisible();
        expect(await legacyPhotos(adminWorld.emulators)).toEqual(photos);
    },
);

/*
 * The Firestore emulator stamps every delete's event with one fake account (`fake-auth-id@gmail.com`), whoever deleted,
 * so a person's delete cannot be told from the server's here: that the import never brings back a photo a person
 * deleted is pinned by the unit tests (`legacy-import.test.ts`, `legacy-photos.test.ts`); here a photo the server removed
 * is imported again, as it must be.
 */
test(
    'Importing again never undoes what the owner did: a new title stays, an unpublished photo stays unpublished',
    { tag: ['@S-A28-BAD-OWNER-EDITS-KEPT'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(420_000);
        let records: readonly BundleRecord[] = [];
        await serveBundle(page, (all) => {
            records = firstAnd(true)(all);
            return records;
        });
        const stale = await page.context().newPage();
        await serveBundle(stale, firstAnd(true));
        const first = await importCard(page, lang, 5);
        const later = await importCard(stale, lang, 5);
        await first.action.click();
        await imported(page, lang, 5);
        const [retitled, removed, unpublished] = records.map((record) => `cities/bucharest/photos/${record.photo.id}`);
        const { emulators } = adminWorld;
        const owner = adminWorld.accounts.owner.uid;
        await emulators.updateFields(retitled ?? '', { title: { ro: 'Titlul proprietarului' }, updatedBy: owner, updatedAt: new Date() }, [
            'title',
            'updatedBy',
            'updatedAt',
        ]);
        await emulators.updateFields(unpublished ?? '', { published: false, updatedBy: owner, updatedAt: new Date() }, [
            'published',
            'updatedBy',
            'updatedAt',
        ]);
        await emulators.deleteDocument(removed ?? '');
        // The history trigger records the owner's unpublish (the import reads it).
        await expect
            .poll(() => ownersEntries(emulators, unpublished ?? '', owner), { timeout: 60_000 })
            .toContainEqual(expect.objectContaining({ previous: expect.objectContaining({ published: true }) }));

        // The tab opened before the import still offers it: its run uploads only the photo the server removed.
        const uploads = countUploads(stale);
        await later.action.click();
        await imported(stale, lang, 5);

        expect(uploads()).toBe(1);
        expect(await emulators.document(removed ?? '')).toMatchObject({ published: true, processing: 'done' });
        expect(await emulators.document(unpublished ?? '')).toMatchObject({ published: false });
        expect(await emulators.document(retitled ?? '')).toMatchObject({ title: { ro: 'Titlul proprietarului' }, published: true });
    },
);

/** The history entries of a photo that `uid` wrote (its edits). */
async function ownersEntries(emulators: EmulatorWorld, photo: string, uid: string): Promise<Record<string, unknown>[]> {
    return Object.values(await emulators.collection(`${photo}/history`)).filter((entry) => entry['updatedBy'] === uid);
}

/** Parc Ferdinand as the first migration left it, and the old site's later point and cone (corrections.json). */
const PARC = 'parcul-ferdinand-1930';
const MIGRATED = { lat: 44.448214, lng: 26.139544 };
const LATER = { lat: 44.448183, lng: 26.139431 };

/** Parc Ferdinand and Strada Grădinarilor (Studiourile Buftea), as a map that imported them holds them. */
function parcAndBuftea(records: readonly BundleRecord[]): readonly BundleRecord[] {
    return records.filter((record) => [PARC, 'strada-gradinarilor'].includes(record.photo.id));
}

/** The two photos imported, processed and published; Parc Ferdinand where the first migration put it, without a direction. */
async function seedImported(emulators: EmulatorWorld, owner: string): Promise<void> {
    const imported = {
        license: 'permission-legacy',
        rightsReview: true,
        processing: 'done',
        published: true,
        links: [],
        createdBy: owner,
        createdAt: new Date(),
        updatedBy: owner,
        updatedAt: new Date(),
    };
    const image = (id: string): Record<string, unknown> => ({
        web: `https://storage.e2e.test/${id}/web.webp`,
        thumb: `https://storage.e2e.test/${id}/thumb.webp`,
        sha256: 'a'.repeat(64),
        w: 1,
        h: 1,
    });
    await emulators.setDocument(`cities/bucharest/photos/${PARC}`, {
        ...imported,
        title: { ro: 'Parcul Ferdinand' },
        legacyId: 'ci9l6usag007xkkm5f377j291',
        location: MIGRATED,
        image: image(PARC),
    });
    await emulators.setDocument('cities/bucharest/photos/strada-gradinarilor', {
        ...imported,
        title: { ro: 'Strada Grădinarilor' },
        author: 'Studiourile Buftea',
        legacyId: 'ci9l6usag007xkkm5f377j176',
        location: { lat: 44.414593, lng: 26.126315 },
        bearing: 90,
        fov: 50,
        image: image('strada-gradinarilor'),
    });
}

test(
    "A map whose photo has no direction gets the old site's in one click, and the credits name the new author",
    { tag: ['@S-A28-HAPPY-DIRECTIONS'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        const owner = adminWorld.accounts.owner.uid;
        await seedImported(emulators, owner);
        await serveBundle(page, parcAndBuftea);
        const uploads = countUploads(page);

        const { card } = await importCard(page, lang, 2);
        await expect(card.getByText(setupText(lang, 'adminSetup.import.directions', { count: '1' }))).toBeVisible();
        await expect(card.getByText(setupText(lang, 'adminSetup.import.credits'))).toBeVisible();
        await card
            .getByRole('button', { name: setupText(lang, 'adminSetup.import.actionDirections', { count: '1' }), exact: true })
            .click();
        await imported(page, lang, 2);

        expect(uploads()).toBe(0);
        expect(await emulators.document(`cities/bucharest/photos/${PARC}`)).toMatchObject({ location: LATER, bearing: 219.1, fov: 50 });
        expect(await emulators.document('cities/bucharest/photos/strada-gradinarilor')).toMatchObject({ bearing: 90, fov: 50 });
        expect(await emulators.document('cities/bucharest')).toMatchObject({
            credits: [{ label: { ro: 'Fotografii: Studiourile Buftea', en: 'Photos: Studiourile Buftea' } }],
        });
        // The history trigger records the import's aim (stamped with the owner's uid) before the next test's reset, which
        // it would otherwise outlive and read as the owner's own direction (docs/LESSONS.md 475).
        await expect
            .poll(() => ownersEntries(emulators, `cities/bucharest/photos/${PARC}`, owner), { timeout: 60_000 })
            .toContainEqual(expect.objectContaining({ changedFields: expect.arrayContaining(['bearing']) }));
    },
);

test(
    "The owner's own direction and place are never overwritten by the old site's",
    { tag: ['@S-A28-BAD-OWNER-DIRECTION-KEPT'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        const owner = adminWorld.accounts.owner.uid;
        await seedImported(emulators, owner);
        await serveBundle(page, parcAndBuftea);
        // A tab opened before the owner's change still offers the direction.
        const { card } = await importCard(page, lang, 2);
        const offer = card.getByRole('button', {
            name: setupText(lang, 'adminSetup.import.actionDirections', { count: '1' }),
            exact: true,
        });
        await expect(offer).toBeVisible();

        // The owner aims and moves the photo in the admin (the history trigger records the person's change).
        const own = { location: { lat: 44.4483, lng: 26.1396 }, bearing: 10, fov: 30 };
        const path = `cities/bucharest/photos/${PARC}`;
        await emulators.updateFields(path, { ...own, updatedBy: owner, updatedAt: new Date() }, [
            'location',
            'bearing',
            'fov',
            'updatedBy',
            'updatedAt',
        ]);
        await expect
            .poll(() => ownersEntries(emulators, path, owner), { timeout: 60_000 })
            .toContainEqual(expect.objectContaining({ changedFields: expect.arrayContaining(['bearing']) }));
        await offer.click();
        await imported(page, lang, 2);

        expect(await emulators.document(path)).toMatchObject(own);
        // A tab opened now has no direction to add.
        const fresh = await page.context().newPage();
        await serveBundle(fresh, parcAndBuftea);
        const { card: done } = await importCard(fresh, lang, 2);
        await expect(done.getByText(setupText(lang, 'adminSetup.import.done', { count: '2' }))).toBeVisible();
        await expect(done.getByText(setupText(lang, 'adminSetup.import.directions', { count: '1' }))).toBeHidden();
    },
);
