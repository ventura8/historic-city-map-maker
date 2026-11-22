/**
 * An in-memory `WikipediaApi` for the overlay's tests (no network): pages per language with a place, an extract, a free
 * thumbnail address and titles on the other Wikipedia; `failWith` makes the next calls throw, `calls` counts them.
 */
import type { WikipediaLanguage } from '@hcm/shared';

import { UpstreamError, type UpstreamFailure } from '../../src/ports/errors.js';
import type { WikipediaApi, WikipediaImage, WikipediaPage, WikipediaPlace } from '../../src/ports/wikipedia-api.js';

export interface FakeWikiPage extends WikipediaPlace {
    readonly language: WikipediaLanguage;
    readonly extract?: string;
    readonly thumbnail?: string;
    readonly titles?: WikipediaPage['titles'];
}

export interface FakeWikipedia extends WikipediaApi {
    readonly calls: { places: number; pages: number; image: number };
    failWith(failure: UpstreamFailure | Error | null): void;
}

export const FAKE_IMAGE: WikipediaImage = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), contentType: 'image/jpeg' };

export function wikiPage(
    language: WikipediaLanguage,
    pageId: number,
    title: string,
    lng: number,
    lat: number,
    extra: Partial<FakeWikiPage> = {},
): FakeWikiPage {
    return { language, pageId, title, lng, lat, ...extra };
}

export function createFakeWikipedia(
    pages: readonly FakeWikiPage[],
    images: ReadonlyMap<string, WikipediaImage | Error> = new Map(),
): FakeWikipedia {
    const calls = { places: 0, pages: 0, image: 0 };
    let failure: UpstreamFailure | Error | null = null;
    const check = (): void => {
        if (failure instanceof Error) {
            throw failure;
        }
        if (failure !== null) {
            throw new UpstreamError('wikipedia', failure);
        }
    };
    return {
        calls,
        failWith(next) {
            failure = next;
        },
        places(language, box) {
            calls.places += 1;
            check();
            const found = pages.filter(
                (page) =>
                    page.language === language &&
                    page.lng >= box.west &&
                    page.lng <= box.east &&
                    page.lat >= box.south &&
                    page.lat <= box.north,
            );
            return Promise.resolve(found.map(({ pageId, title, lat, lng }) => ({ pageId, title, lat, lng })));
        },
        pages(language, pageIds, others) {
            calls.pages += 1;
            check();
            const found = pages.filter((page) => page.language === language && pageIds.includes(page.pageId));
            return Promise.resolve(
                found.map((page) => {
                    const titles = Object.fromEntries(
                        Object.entries(page.titles ?? {}).filter(([other]) => others.includes(other as WikipediaLanguage)),
                    );
                    const details = {
                        pageId: page.pageId,
                        title: page.title,
                        extract: page.extract ?? '',
                        url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`,
                        titles,
                    };
                    return page.thumbnail === undefined ? details : { ...details, thumbnail: page.thumbnail };
                }),
            );
        },
        image(url) {
            calls.image += 1;
            const image = images.get(url);
            if (image instanceof Error) {
                return Promise.reject(image);
            }
            return Promise.resolve(image);
        },
    };
}
