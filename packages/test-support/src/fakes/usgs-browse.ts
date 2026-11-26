import { fixtureResponse } from '../api-fixtures/index.js';
import type { Bytes } from './png.js';
import { route, type Route } from './routes.js';
import type { ServiceFake } from './service.js';
import { catalogueScenes } from './usgs-catalogue.js';

/**
 * USGS's browse image server (`ims.cr.usgs.gov`, docs/research/M3-interfaces.md §3.4, §13): the public, never signed
 * preview of each scene of the catalogue, which `imagery.browse` copies server-side into our bucket (the browser never
 * requests a USGS address). Every scene answers the same small generated JPEG (a grey film frame with a road, a river
 * and its border) but the paid-only 1968 twin `DS1105-1071DF076`, whose browse answers 503 (S-A11-BAD-BROWSE-UNAVAILABLE);
 * failure `unavailable` makes every one answer 503. A service of its own, so the browse host can fail while M2M answers.
 */

/** The scene whose browse image is always unavailable. */
export const UNAVAILABLE_BROWSE_SCENE = 'DS1105-1071DF076';

/** A 120 × 90 grey JPEG (generated once with sharp; 1.8 KB), split so no line passes the column limit. */
const BROWSE_JPEG_BASE64 = [
    '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',
].join('');

/** The browse image's bytes. */
export function browseJpeg(): Bytes {
    return Uint8Array.from(atob(BROWSE_JPEG_BASE64), (char) => char.charCodeAt(0));
}

/** Browse and thumbnail path (`/browse/declass1/<entity>.jpg`) → the scene's entity id. */
function browsePaths(): ReadonlyMap<string, string> {
    return new Map(
        catalogueScenes().flatMap(({ result }) =>
            result.browse.flatMap((browse) => [
                [new URL(browse.browsePath).pathname, result.entityId] as const,
                [new URL(browse.thumbnailPath).pathname, result.entityId] as const,
            ]),
        ),
    );
}

/** M25: LandsatLook's browse of a product (`/gen-browse?product_id=`) → the scene's entity id. */
function landsatProducts(): ReadonlyMap<string, string> {
    return new Map(catalogueScenes().map(({ result }) => [result.displayId, result.entityId] as const));
}

const answerBrowse: Route['answer'] = (request) => {
    const product = request.url.searchParams.get('product_id');
    const entityId = product === null ? browsePaths().get(request.url.pathname) : landsatProducts().get(product);
    if (entityId === undefined) {
        return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    if (entityId === UNAVAILABLE_BROWSE_SCENE) {
        return fixtureResponse('usgs/browse.unavailable');
    }
    return new Response(browseJpeg(), { status: 200, headers: { 'content-type': 'image/jpeg' } });
};

/** The fake browse image server. */
export function createUsgsBrowseFake(): ServiceFake {
    return {
        name: 'usgs-browse',
        routes: [
            route('GET', 'https://ims.cr.usgs.gov/browse/{path*}', 'usgs-browse.browse', answerBrowse),
            route('GET', 'https://ims.cr.usgs.gov/thumbnail/{path*}', 'usgs-browse.thumbnail', answerBrowse),
            route('GET', 'https://landsatlook.usgs.gov/gen-browse', 'usgs-browse.landsat', answerBrowse),
        ],
        failure: (mode) => (mode === 'unavailable' ? fixtureResponse('usgs/browse.unavailable') : undefined),
        scenarios: {},
        snapshot: () => ({}),
    };
}
