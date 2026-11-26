/**
 * The photo editor's assists (`packages/admin/src/photos/assists.ts`; `docs/research/M4-interfaces.md` §4.1, CR-M4-4)
 * through the photos area: the pin set on the map with no title asks for suggestions, a suggestion fills the draft's
 * title (and its English name), a draft fills the other language of a text, and nothing is written before Save.
 */
import { FIRESTORE_PATHS, NOMINATIM_ATTRIBUTION, type CallableResponse } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { PHOTOS_MODULE } from '../../src/photos/module.js';
import { withDraft } from '../../src/assist/editor-assists.js';
import { photoAssists } from '../../src/photos/assists.js';
import type { PhotoValue } from '../../src/photos/draft.js';
import { contentWorld, type ContentWorld } from '../content/world.js';
import { photoDoc } from './world.js';

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

function open(world: ContentWorld, title: { readonly ro: string; readonly en?: string }) {
    world.store.put(FIRESTORE_PATHS.photo('bucharest', 'p1'), photoDoc({ title }));
    const photos = PHOTOS_MODULE.create(world.services);
    photos.open(['p1']);
    return photos;
}

describe('the photo editor assists', () => {
    it('happyPath_suggestionsFillTheDraftsTitleAndNothingIsSaved', async () => {
        const world = contentWorld();
        world.callables.answer('assist.suggestTitle', () => ({
            state: 'ready',
            key: 'n444413_e260973',
            suggestions: [{ ro: 'Ateneul Român', en: 'Romanian Athenaeum' }, { ro: 'Sector 1' }],
            attribution: NOMINATIM_ATTRIBUTION,
        }));
        const photos = open(world, { ro: 'Vechi', en: 'Old' });

        photos.intents.suggestTitle();
        await settled();
        photos.intents.useTitle(1);
        expect(photos.state.editor?.value?.title).toEqual({ ro: 'Sector 1', en: 'Old' });
        photos.intents.useTitle(0);
        photos.intents.useTitle(7);

        expect(photos.state.editor?.value?.title).toEqual({ ro: 'Ateneul Român', en: 'Romanian Athenaeum' });
        expect(photos.state.editor?.dirty).toContain('title');
        expect(world.store.writes).toEqual([]);
    });

    it('happyPath_draftsFillTheOtherLanguageOfATextUntilSave', async () => {
        const world = contentWorld();
        world.callables.answer('assist.translateDraft', (request) => {
            const { text, to } = request as { readonly text: string; readonly to: string };
            return { draft: `${text} [${to}]`, truncated: false, model: 'gemini-3.5-flash-lite' };
        });
        const photos = open(world, { ro: 'Ateneul Român' });
        photos.intents.edit({ description: { ro: '', en: 'A concert hall.' } });

        photos.intents.draftText('title', 'en');
        photos.intents.draftText('description', 'ro');
        photos.intents.draftText('dateText', 'en');
        photos.intents.draftText('location', 'en');
        await settled();

        expect(photos.state.editor?.value?.title).toEqual({ ro: 'Ateneul Român', en: 'Ateneul Român [en]' });
        expect(photos.state.editor?.value?.description).toEqual({ ro: 'A concert hall. [ro]', en: 'A concert hall.' });
        expect(world.callables.named('assist.translateDraft')).toBe(2);
        expect(photos.state.assist.drafts['title.en']).toMatchObject({ status: 'done', model: 'gemini-3.5-flash-lite' });
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_noPhotoOpenOrALeftPhotoAsksNothingAndForgetsEverything', async () => {
        const world = contentWorld();
        world.callables.answer('assist.suggestTitle', () => ({
            state: 'ready',
            key: 'n1_e1',
            suggestions: [{ ro: 'X' }],
            attribution: 'a',
        }));
        const photos = PHOTOS_MODULE.create(world.services);
        photos.open([]);

        photos.intents.suggestTitle();
        photos.intents.useTitle(0);
        photos.intents.draftText('title', 'en');
        await settled();
        expect(world.callables.calls).toEqual([]);

        world.store.put(FIRESTORE_PATHS.photo('bucharest', 'p1'), photoDoc({ title: { ro: 'A' } }));
        photos.open(['p1']);
        photos.intents.suggestTitle();
        await settled();
        photos.open([]);

        expect(photos.state.assist.titles.status).toBe('idle');
    });

    it('happyPath_aPinSetOnAnUntitledPhotoAsksForTitlesByItself', async () => {
        const world = contentWorld();
        world.callables.answer('assist.suggestTitle', () => ({ state: 'ready', key: 'n1_e1', suggestions: [], attribution: 'a' }));
        let value: PhotoValue | null = { ...photoDoc({ title: { ro: ' ' } }) };
        const file: { title?: string } = {};
        const assists = photoAssists({
            ...{ services: world.services, value: () => value, fileTitle: () => file.title },
            ...{ edit: () => undefined, changed: () => undefined },
        });
        const placeAt = async (title: string | null, lat: number): Promise<void> => {
            value = title === null ? null : { ...photoDoc({ title: { ro: title } }) };
            assists.placeSet({ lat, lng: 26.1 });
            await settled();
        };

        // Empty, a camera's naming (an upload's file name) and the title the file gave it ask; a chosen title does not.
        await placeAt(' ', 44.43);
        await placeAt('IMG 0412', 44.44);
        file.title = 'Strada Lipscani';
        await placeAt('Strada Lipscani', 44.45);
        await placeAt('Titlu', 44.46);
        await placeAt(null, 44.47);

        expect(world.callables.calls.map((call) => (call.request as { location: { lat: number } }).location.lat)).toEqual([
            44.43, 44.44, 44.45,
        ]);
        expect(assists.state.titles.status).toBe('ready');
    });

    it('badPath_aDraftThatArrivesAfterAnotherPhotoOpenedLandsNowhere', async () => {
        const world = contentWorld();
        const pending: { resolve?: (value: CallableResponse<'assist.translateDraft'>) => void } = {};
        world.callables.answer(
            'assist.translateDraft',
            () =>
                new Promise<CallableResponse<'assist.translateDraft'>>((resolve) => {
                    pending.resolve = resolve;
                }),
        );
        world.store.put(FIRESTORE_PATHS.photo('bucharest', 'p2'), photoDoc({ title: { ro: 'Gara de Nord' } }));
        const photos = open(world, { ro: 'Ateneul Român' });
        photos.intents.draftText('title', 'en');
        await settled();

        photos.open(['p2']);
        pending.resolve?.({ draft: 'Romanian Athenaeum', truncated: false, model: 'gemini-3.5-flash-lite' });
        await settled();

        expect(photos.state.editor?.value?.title).toEqual({ ro: 'Gara de Nord' });
        expect(photos.state.editor?.dirty).toEqual([]);
        expect(photos.state.assist.drafts).toEqual({});
    });

    it('happyPath_withDraftKeepsTheOtherLanguage', () => {
        expect(withDraft(undefined, 'ro', 'Nou')).toEqual({ ro: 'Nou' });
        expect(withDraft({ ro: 'Vechi', en: 'Old' }, 'ro', 'Nou')).toEqual({ ro: 'Nou', en: 'Old' });
    });
});
