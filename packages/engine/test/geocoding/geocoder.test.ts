import { describe, expect, it, vi } from 'vitest';

import { mapboxGeocoder } from '../../src/geocoding/geocoder.js';

describe('Mapbox geocoder', () => {
    it('requests temporary results within the city and maps the response', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    features: [
                        { id: 'one', geometry: { coordinates: [26, 44] }, properties: { name: 'Street', full_address: 'Street, City' } },
                    ],
                }),
            ),
        );
        const signal = new AbortController().signal;
        const results = await mapboxGeocoder(fetcher).search({
            query: 'street',
            bounds: [
                [25, 43],
                [27, 45],
            ],
            locale: 'en',
            token: 'test-public-token',
            signal,
        });
        const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
        expect(url.origin + url.pathname).toBe('https://api.mapbox.com/search/geocode/v6/forward');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            q: 'street',
            access_token: 'test-public-token',
            bbox: '25,43,27,45',
            language: 'en',
            types: 'address,street,place,poi,neighborhood',
            limit: '5',
            permanent: 'false',
        });
        expect(init.signal).toBe(signal);
        expect(results).toEqual([{ id: 'one', title: 'Street', subtitle: 'Street, City', center: [26, 44] }]);
    });

    it('rejects failed requests and falls back to the formatted place or an empty subtitle', async () => {
        const fetcher = vi.fn<typeof fetch>();
        const request = {
            query: 'abc',
            bounds: [
                [25, 43],
                [27, 45],
            ] as const,
            locale: 'ro' as const,
            token: 'test-public-token',
            signal: new AbortController().signal,
        };
        fetcher.mockResolvedValueOnce(new Response('', { status: 503 }));
        await expect(mapboxGeocoder(fetcher).search(request)).rejects.toThrow('Geocoding failed (503)');
        fetcher.mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    features: [
                        { id: 'a', geometry: { coordinates: [26, 44] }, properties: { name: 'A', place_formatted: 'City' } },
                        { id: 'b', geometry: { coordinates: [26, 44] }, properties: { name: 'B' } },
                    ],
                }),
            ),
        );
        expect((await mapboxGeocoder(fetcher).search(request)).map((result) => result.subtitle)).toEqual(['City', '']);
    });
});
