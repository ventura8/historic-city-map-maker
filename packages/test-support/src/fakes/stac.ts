import { FIXTURE_VALUES, fixtureResponse } from '../api-fixtures/index.js';
import { route, type Route } from './routes.js';
import type { ServiceFake } from './service.js';
import { rangedResponse, type DeliverySource } from './usgs-downloads.js';

/**
 * A public STAC catalogue of Sentinel-2 L2A (Element 84's Earth Search, docs/research/M3-interfaces.md §5.5, §13) and the
 * bucket that serves its COGs: the pipeline's `reference` step searches the window and reads the first item's `visual`
 * asset through GDAL `/vsicurl/`, with ranges. The search answers one item (`stac/search.one-item.json`), or none with
 * `stac.empty`; the COG answers the bytes the e2e world registers (the synthetic world's Sentinel-2-like COG) and 404
 * without them. Called by the pipeline only: the admin's pages never reach either host (the e2e firewall).
 */

export interface StacState {
    /** `stac.empty`: no item under 20 % clouds over the window. */
    empty: boolean;
    /** The origin of the asset addresses the search answers (the e2e world points it at the mock APIs' forward). */
    cogOrigin: string;
    /** The `visual` COG's bytes, or undefined (404). */
    cog: DeliverySource | undefined;
}

export function defaultStacState(): StacState {
    return { empty: false, cogOrigin: String(FIXTURE_VALUES['cogOrigin']), cog: undefined };
}

const SEARCH = 'https://earth-search.aws.element84.com/v1/search';
/** The bucket of the item's COGs (the default `cogOrigin`). */
const COG_HOST = new URL(String(FIXTURE_VALUES['cogOrigin'])).hostname;
/** The one item's `visual` asset, below the origin. */
export const STAC_VISUAL_PATH = '/sentinel-s2-l2a-cogs/35/T/MK/2025/8/S2B_35TMK_20250803_0_L2A/TCI.tif';

const S3_NOT_FOUND = (): Response =>
    new Response('<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>NoSuchKey</Code></Error>\n', {
        status: 404,
        headers: { 'content-type': 'application/xml' },
    });

/** The fake STAC catalogue and its COG bucket. */
export function createStacFake(state: StacState): ServiceFake {
    const search: Route['answer'] = () =>
        state.empty
            ? fixtureResponse('stac/search.empty')
            : fixtureResponse('stac/search.one-item', { values: { cogOrigin: state.cogOrigin } });
    const cog: Route['answer'] = async (request) => {
        if (request.url.pathname !== STAC_VISUAL_PATH || state.cog === undefined) {
            return S3_NOT_FOUND();
        }
        return rangedResponse(request, await state.cog(), 'image/tiff', true);
    };
    return {
        name: 'stac',
        routes: [
            route('POST', SEARCH, 'stac.search', search),
            route('GET', SEARCH, 'stac.search.get', search),
            route('GET', `https://${COG_HOST}/{path*}`, 'stac.cog', cog),
            route('HEAD', `https://${COG_HOST}/{path*}`, 'stac.cog.head', cog),
        ],
        failure: (mode) => (mode === 'unavailable' ? fixtureResponse('stac/error.unavailable') : undefined),
        scenarios: {
            empty: () => {
                state.empty = true;
            },
        },
        snapshot: () => ({ empty: state.empty, cogOrigin: state.cogOrigin, cog: state.cog !== undefined }),
    };
}
