import type { Fetch } from './upstream-http.js';

/**
 * The `fetch` the REST adapters get inside the Functions emulator (`FUNCTIONS_EMULATOR=true`; CR-M2-14, CR-M2-22): no
 * adapter may reach a real Google, Mapbox or USGS host from a local run. A call to an upstream the fakes serve
 * (`https://<host><path>`) goes to the fake upstreams as `<base>/h/<host><path>` (the e2e mock APIs, or
 * `startUpstreamServer` of `@hcm/test-support/fakes/http`); every other call, and every call while `HCM_UPSTREAM_BASE`
 * is unset or not a loopback address, fails like a network error, which the adapters report as `unavailable`.
 */

/**
 * The upstreams the adapters call: Mapbox, USGS M2M and the Google REST APIs (OAuth tokeninfo, and in M4 Vertex AI at
 * `us-central1-aiplatform.googleapis.com` and FCM included); USGS's browse images (M25: LandsatLook's too) and the e2e tile server
 * `tiles.e2e.test` (an XYZ source to probe), which `RemoteFiles` fetches (CR-M3-14); Nominatim (M4's title suggestions).
 */
const UPSTREAM_HOSTS: readonly RegExp[] = [
    /^api\.mapbox\.com$/,
    /^m2m\.cr\.usgs\.gov$/,
    /^[a-z0-9-]+\.googleapis\.com$/,
    /^ims\.cr\.usgs\.gov$/,
    // M25: LandsatLook's browse of a Landsat scene.
    /^landsatlook\.usgs\.gov$/,
    /^tiles\.e2e\.test$/,
    /^nominatim\.openstreetmap\.org$/,
];

/** Only a fake on this machine: `http://127.0.0.1:<port>` or `http://localhost:<port>`, no path. */
const LOOPBACK_BASE = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/;

function urlOf(input: Parameters<Fetch>[0]): URL {
    if (typeof input === 'string' || input instanceof URL) {
        return new URL(input);
    }
    return new URL(input.url);
}

function refused(url: URL): Promise<Response> {
    return Promise.reject(new TypeError(`fetch refused in the Functions emulator: ${url.protocol}//${url.host}`));
}

export function createEmulatorFetch(base: string | undefined, upstream: Fetch): Fetch {
    const target = base !== undefined && LOOPBACK_BASE.test(base) ? base : undefined;
    return (input, init) => {
        const url = urlOf(input);
        const served = url.protocol === 'https:' && UPSTREAM_HOSTS.some((host) => host.test(url.hostname));
        if (target === undefined || !served) {
            return refused(url);
        }
        const forwarded = `${target}/h/${url.host}${url.pathname}${url.search}`;
        return input instanceof Request ? upstream(new Request(forwarded, input), init) : upstream(forwarded, init);
    };
}
