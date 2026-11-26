import type { ViewerLocale } from '@hcm/shared';
import type { APIRequestContext, Page } from '@playwright/test';
import sharp from 'sharp';

import { MOCK_API_ORIGIN, type Rgb } from '../fixtures/world.js';
import type { RecordedCall } from '../mock-apis/server.js';

/**
 * Helpers for the specs: open a built site, read the mock APIs' record of the
 * test's calls, and probe a map pixel (docs/research/design-review-testability.md §4.2: map assertions are pixel
 * probes on known synthetic colours, never screenshots of Mapbox).
 */

/** The e2e sites (e2e/scripts/build-site.ts); `bucharest-bucket` reads its manifest from the public bucket (§51e). */
export type SiteName = 'bucharest' | 'bucharest-bucket' | 'starter-kit';

export interface OpenOptions {
    /** `?lang=` (docs/ENGINE_API.md → Language: the URL wins over the stored choice and config.js). */
    readonly lang?: ViewerLocale;
    /** The URL hash without `#` (`14/44.43/26.1&photo=...`). */
    readonly hash?: string;
}

/** The path of a built site on the site server, with the language and the hash. */
export function sitePath(site: SiteName, options: OpenOptions = {}): string {
    const query = options.lang === undefined ? '' : `?lang=${options.lang}`;
    const hash = options.hash === undefined ? '' : `#${options.hash}`;
    return `/${site}/${query}${hash}`;
}

/** The mock APIs' record of one test's forwarded calls. */
export class MockApis {
    readonly #api: APIRequestContext;
    readonly testId: string;

    constructor(api: APIRequestContext, testId: string) {
        this.#api = api;
        this.testId = testId;
    }

    /** Every call this test made to a mocked host (to `host` only, when given), oldest first. */
    async calls(host?: string): Promise<RecordedCall[]> {
        const query = new URLSearchParams({ test: this.testId, ...(host === undefined ? {} : { host }) });
        const response = await this.#api.get(`${MOCK_API_ORIGIN}/__calls?${query.toString()}`);
        return (await response.json()) as RecordedCall[];
    }

    /** Mapbox map loads billed so far: the `map.load` events Mapbox GL posted to events.mapbox.com. */
    async mapLoadEvents(): Promise<number> {
        const events = await this.calls('events.mapbox.com');
        return events.filter((call) => call.body.includes('"event":"map.load"')).length;
    }
}

/** The colour of the CSS pixel at (`x`, `y`) of the page as the user sees it. */
export async function probePixel(page: Page, x: number, y: number): Promise<Rgb> {
    const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, scale: 'css', animations: 'disabled', caret: 'hide' });
    const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return [Number(data[0]), Number(data[1]), Number(data[2])];
}

/** True when every channel of `actual` is within `tolerance` of `expected`. */
export function isColour(actual: Rgb, expected: Rgb, tolerance = 3): boolean {
    return actual.every((channel, index) => Math.abs(channel - Number(expected[index])) <= tolerance);
}
