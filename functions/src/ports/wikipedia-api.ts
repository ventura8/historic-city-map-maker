import type { WikipediaLanguage } from '@hcm/shared';

/**
 * Wikipedia's MediaWiki API (`docs/research/M31-wikipedia.md` §2), as the overlay's fetch needs it: the geotagged pages
 * of a box, then their first sentences, address, free page image and titles in the other languages, then a thumbnail's
 * bytes. Failures are `UpstreamError('wikipedia', …)`.
 */
export interface WikipediaBox {
    readonly west: number;
    readonly south: number;
    readonly east: number;
    readonly north: number;
}

/** A geotagged page of `list=geosearch`. */
export interface WikipediaPlace {
    readonly pageId: number;
    readonly title: string;
    readonly lat: number;
    readonly lng: number;
}

/** A page's details (`prop=extracts|info|pageimages|langlinks`). */
export interface WikipediaPage {
    readonly pageId: number;
    readonly title: string;
    /** The first sentences, plain text ('' when the page has none). */
    readonly extract: string;
    readonly url: string;
    /** The page image's thumbnail address, only when Wikipedia marks the image free (`pilicense=free`). */
    readonly thumbnail?: string;
    /** The page's title on the other Wikipedias asked for. */
    readonly titles: Readonly<Partial<Record<WikipediaLanguage, string>>>;
}

export interface WikipediaImage {
    readonly bytes: Uint8Array;
    readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface WikipediaApi {
    /** The geotagged pages in `box` (at most 500, nearest the box's centre first). */
    places(language: WikipediaLanguage, box: WikipediaBox): Promise<readonly WikipediaPlace[]>;
    /** Up to 20 pages' details, with their titles in `others`. */
    pages(language: WikipediaLanguage, pageIds: readonly number[], others: readonly WikipediaLanguage[]): Promise<readonly WikipediaPage[]>;
    /** A thumbnail of `upload.wikimedia.org`; undefined for any other address, type or a file over the size cap. */
    image(url: string): Promise<WikipediaImage | undefined>;
}
