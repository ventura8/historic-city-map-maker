import { describe, expect, it, vi } from 'vitest';

import { createEmulatorFetch } from '../../src/adapters/emulator-fetch.js';

const FAKES = 'http://127.0.0.1:4311';

function upstream() {
    return vi.fn<typeof fetch>((input) => Promise.resolve(new Response(input instanceof Request ? input.method : 'ok')));
}

/** The same address over plain HTTP, which no upstream is reached by. */
function plainHttp(url: string): URL {
    const insecure = new URL(url);
    insecure.protocol = 'http:';
    return insecure;
}

describe('createEmulatorFetch', () => {
    it('happyPath_anUpstreamCallGoesToTheFakesWithItsPathAndQuery', async () => {
        const fetch = upstream();
        const init = { method: 'POST', body: '{}' };

        await createEmulatorFetch(FAKES, fetch)('https://api.mapbox.com/tokens/v2/e2e-user?limit=100', init);

        expect(fetch).toHaveBeenCalledWith(`${FAKES}/h/api.mapbox.com/tokens/v2/e2e-user?limit=100`, init);
    });

    it.each([
        ['https://oauth2.googleapis.com/tokeninfo', `${FAKES}/h/oauth2.googleapis.com/tokeninfo`],
        [new URL('https://m2m.cr.usgs.gov/api/api/json/stable/login-token'), `${FAKES}/h/m2m.cr.usgs.gov/api/api/json/stable/login-token`],
        [
            'https://firebase.googleapis.com/v1beta1/projects/demo-hcm/webApps',
            `${FAKES}/h/firebase.googleapis.com/v1beta1/projects/demo-hcm/webApps`,
        ],
        ['https://ims.cr.usgs.gov/browse/declass1/DS1105-1071DF075.jpg', `${FAKES}/h/ims.cr.usgs.gov/browse/declass1/DS1105-1071DF075.jpg`],
        [
            'https://landsatlook.usgs.gov/gen-browse?size=rrb&type=refl&product_id=LT05_L1TP_183029_19890712_20200916_02_T1',
            `${FAKES}/h/landsatlook.usgs.gov/gen-browse?size=rrb&type=refl&product_id=LT05_L1TP_183029_19890712_20200916_02_T1`,
        ],
        ['https://tiles.e2e.test/xyz/e2e-1980/12/2344/1482.png', `${FAKES}/h/tiles.e2e.test/xyz/e2e-1980/12/2344/1482.png`],
        // M4: Nominatim (the title suggestions' queue), Vertex AI and FCM (googleapis.com hosts).
        [
            'https://nominatim.openstreetmap.org/reverse?lat=44.4&lon=26.1',
            `${FAKES}/h/nominatim.openstreetmap.org/reverse?lat=44.4&lon=26.1`,
        ],
        [
            'https://fcm.googleapis.com/v1/projects/demo-hcm/messages:send',
            `${FAKES}/h/fcm.googleapis.com/v1/projects/demo-hcm/messages:send`,
        ],
    ])('happyPath_everyServedHostIsForwarded %s', async (input, forwarded) => {
        const fetch = upstream();

        await createEmulatorFetch('http://localhost:4311', fetch)(input);

        expect(fetch).toHaveBeenCalledWith(forwarded.replace(FAKES, 'http://localhost:4311'), undefined);
    });

    it('happyPath_aRequestObjectKeepsItsMethod', async () => {
        const fetch = upstream();

        const response = await createEmulatorFetch(FAKES, fetch)(new Request('https://api.mapbox.com/tokens/v2', { method: 'DELETE' }));

        expect(await response.text()).toBe('DELETE');
        expect(fetch.mock.calls[0]?.[0]).toMatchObject({ url: `${FAKES}/h/api.mapbox.com/tokens/v2` });
    });

    it.each([
        ['an unknown host', new URL('https://www.example.com/')],
        ['plain http', plainHttp('https://api.mapbox.com/tokens/v2')],
        ['a look-alike host', new URL('https://api.mapbox.com.example.net/tokens/v2')],
        ['a look-alike browse host', new URL('https://ims.cr.usgs.gov.example.net/browse/x.jpg')],
        ['the metadata server', plainHttp('https://metadata.google.internal/computeMetadata/v1/')],
    ])('badPath_%sIsRefusedLikeANetworkError', async (_case, url) => {
        const fetch = upstream();

        await expect(createEmulatorFetch(FAKES, fetch)(url)).rejects.toThrow(TypeError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
        ['unset', undefined],
        ['a remote host', 'https://fakes.example.com'],
        ['a path', `${FAKES}/h`],
    ])('badPath_withTheFakesBase%sEveryCallIsRefused', async (_case, base) => {
        const fetch = upstream();

        await expect(createEmulatorFetch(base, fetch)('https://api.mapbox.com/tokens/v2')).rejects.toThrow(
            'fetch refused in the Functions emulator: https://api.mapbox.com',
        );
        expect(fetch).not.toHaveBeenCalled();
    });
});
