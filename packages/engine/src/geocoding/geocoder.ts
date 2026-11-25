/** Display-only forward geocoding; callers own debounce, cancellation and result lifetime. */
import type { BBox, LngLat, ViewerLocale } from '@hcm/shared';

export interface GeocodingResult {
    readonly id: string;
    readonly title: string;
    readonly subtitle: string;
    readonly center: LngLat;
}

export interface GeocodingQuery {
    readonly query: string;
    readonly bounds: BBox;
    readonly locale: ViewerLocale;
    readonly token: string;
    readonly signal: AbortSignal;
}

export interface GeocoderPort {
    search(query: GeocodingQuery): Promise<readonly GeocodingResult[]>;
}

interface Feature {
    readonly id: string;
    readonly geometry: { readonly coordinates: LngLat };
    readonly properties: { readonly name: string; readonly full_address?: string; readonly place_formatted?: string };
}

/** Mapbox Geocoding v6 adapter. Responses are temporary and must not be persisted. */
export function mapboxGeocoder(fetcher: typeof fetch): GeocoderPort {
    return {
        async search(request) {
            const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
            url.search = new URLSearchParams({
                q: request.query,
                access_token: request.token,
                bbox: request.bounds.flat().join(','),
                language: request.locale,
                types: 'address,street,place,poi,neighborhood',
                limit: '5',
                permanent: 'false',
            }).toString();
            const response = await fetcher(url, { signal: request.signal });
            if (!response.ok) {
                throw new Error(`Geocoding failed (${String(response.status)})`);
            }
            const body = (await response.json()) as { readonly features: readonly Feature[] };
            return body.features.map((feature) => ({
                id: feature.id,
                title: feature.properties.name,
                subtitle: feature.properties.full_address ?? feature.properties.place_formatted ?? '',
                center: feature.geometry.coordinates,
            }));
        },
    };
}
