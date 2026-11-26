/**
 * The Wikipedia overlay in the store (`src/core/wikipedia.ts`, S-V90-*): hidden at open, its file loaded through the lazy
 * chunk the first time it shows, its articles drawn as the overlay's places at every year and opened in the detail sheet; a
 * file that cannot be loaded switches the overlay off with a toast, and switching it on again tries again.
 */
import { WIKIPEDIA_CATEGORY_ID, type Manifest, type PoiCategory, type WikipediaArticle } from '@hcm/shared';
import type { VectorOverlaySpec } from '@hcm/ui/map';
import { describe, expect, it, vi } from 'vitest';

import { wikipediaUrl } from '../../src/core/wikipedia.js';
import { manifest as fixture } from './fixtures.js';
import { loaded } from './harness.js';
import { settle } from './support.js';

const CATEGORY: PoiCategory = {
    id: WIKIPEDIA_CATEGORY_ID,
    label: { ro: 'Wikipedia', en: 'Wikipedia' },
    icon: 'info',
    color: '#3c4043',
    defaultOpacity: 1,
    defaultVisible: false,
    attribution: 'Wikipedia (CC BY-SA 4.0)',
};

const ARTICLE: WikipediaArticle = {
    id: 'ro-1',
    lng: 26.0973,
    lat: 44.4413,
    versions: { ro: { title: 'Ateneul Român', extract: 'Sală.', url: 'https://ro.wikipedia.org/wiki/A' } },
};

function withOverlay(): Manifest {
    const base = fixture();
    return {
        ...base,
        poiCategories: [...(base.poiCategories ?? []), CATEGORY],
        wikipedia: { file: 'wikipedia.json', count: 1, generatedAt: '2026-11-22T08:00:00.000Z' },
    };
}

function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

function wikiSpec(calls: readonly (readonly unknown[])[]): VectorOverlaySpec | undefined {
    return calls.map(([spec]) => spec as VectorOverlaySpec).findLast((spec) => spec.id === WIKIPEDIA_CATEGORY_ID);
}

describe('viewer store: the Wikipedia overlay', () => {
    it('happyPath_switchedOnItLoadsTheFileDrawsTheArticlesAndOpensOne @S-V90-HAPPY-OVERLAY', async () => {
        const load = vi.fn(() => Promise.resolve([ARTICLE]));
        const { store, map } = await loaded({ manifest: withOverlay(), wikipedia: { load } });
        expect(store.getState().overlays.find((overlay) => overlay.id === WIKIPEDIA_CATEGORY_ID)?.visible).toBe(false);
        expect(load).not.toHaveBeenCalled();

        store.toggleOverlay(WIKIPEDIA_CATEGORY_ID, true);
        expect(store.getState().wikipedia.status).toBe('loading');
        await settle();

        expect(load).toHaveBeenCalledWith('https://storage.example.org/cities/bucuresti/wikipedia.json');
        expect(store.getState().wikipedia).toEqual({ status: 'ready', articles: [ARTICLE] });
        expect(wikiSpec(map.callsOf('addVectorOverlay'))?.features.map((feature) => feature.properties.id)).toEqual(['wikipedia-ro-1']);
        store.setYear(1966);
        expect(wikiSpec(map.callsOf('addVectorOverlay'))?.features).toHaveLength(1);

        store.openPoi('wikipedia-ro-1');
        expect(store.getState()).toMatchObject({ sheet: 'poi', selectedPoiId: 'wikipedia-ro-1' });
        store.toggleOverlay(WIKIPEDIA_CATEGORY_ID, false);
        store.toggleOverlay(WIKIPEDIA_CATEGORY_ID, true);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('badPath_aFileThatCannotLoadSwitchesItOffWithAToastAndTriesAgain @S-V90-BAD-FILE-FAILS', async () => {
        const load = vi.fn<(url: string) => Promise<readonly WikipediaArticle[]>>(() => Promise.reject(new Error('offline')));
        const { store, log } = await loaded({ manifest: withOverlay(), wikipedia: { load } });

        store.toggleOverlay(WIKIPEDIA_CATEGORY_ID, true);
        await settle();

        expect(store.getState().wikipedia.status).toBe('failed');
        expect(store.getState().overlays.find((overlay) => overlay.id === WIKIPEDIA_CATEGORY_ID)?.visible).toBe(false);
        expect(store.getState().toast).toEqual({ key: 'wikipedia.loadFailed' });
        expect(log.messages()).toContain('wikipedia file failed');

        load.mockResolvedValueOnce([ARTICLE]);
        store.toggleOverlay(WIKIPEDIA_CATEGORY_ID, true);
        await settle();
        expect(load).toHaveBeenCalledTimes(2);
        expect(store.getState().wikipedia.status).toBe('ready');
    });

    it('badPath_noFileOrNoChunkLoadsNothing', async () => {
        const load = vi.fn(() => Promise.resolve([ARTICLE]));
        const { store } = await loaded({ manifest: { ...withOverlay(), wikipedia: undefined }, wikipedia: { load } });
        store.toggleOverlay(WIKIPEDIA_CATEGORY_ID, true);
        const bare = await loaded({ manifest: withOverlay() });
        bare.store.toggleOverlay(WIKIPEDIA_CATEGORY_ID, true);
        await settle();

        expect(load).not.toHaveBeenCalled();
        expect(bare.store.getState().wikipedia.status).toBe('idle');
    });

    it('badPath_anAnswerForAnOlderManifestIsDropped', async () => {
        const answers = [deferred<readonly WikipediaArticle[]>(), deferred<readonly WikipediaArticle[]>()];
        let call = 0;
        const load = vi.fn(() => answers[call++]?.promise ?? Promise.resolve([]));
        const { store } = await loaded({ manifest: withOverlay(), wikipedia: { load } });

        store.toggleOverlay(WIKIPEDIA_CATEGORY_ID, true);
        await store.retry();
        await settle();
        answers[0]?.resolve([ARTICLE]);
        await settle();
        expect(store.getState().wikipedia.status).toBe('idle');

        store.toggleOverlay(WIKIPEDIA_CATEGORY_ID, true);
        await store.retry();
        await settle();
        answers[1]?.reject(new Error('late'));
        await settle();
        expect(store.getState().toast).toBeNull();
    });
});

describe('wikipediaUrl', () => {
    it('happyPath_relativeToTheManifestOrThePage', () => {
        expect(wikipediaUrl('wikipedia.json', 'https://b.example/c/manifest.json', undefined)).toBe('https://b.example/c/wikipedia.json');
        expect(wikipediaUrl('wikipedia.json', 'data/manifest.json', 'https://site.example/city/')).toBe(
            'https://site.example/city/data/wikipedia.json',
        );
        expect(wikipediaUrl('wikipedia.json', undefined, 'https://site.example/city/')).toBe('https://site.example/city/wikipedia.json');
    });

    it('badPath_withNoBaseTheFileStaysAsItIs', () => {
        expect(wikipediaUrl('wikipedia.json', undefined, undefined)).toBe('wikipedia.json');
    });
});
