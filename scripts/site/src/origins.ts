import { isHttpsUrl, type EngineConfig, type LayerSource, type Manifest } from '@hcm/shared';

import type { ExtraSources } from './csp.js';

/**
 * The origins outside the page that a site's configuration and manifest make the browser contact, so the meta CSP
 * can name exactly those (docs/research/design-review-security-cost.md §1.8). Relative addresses are the page's own
 * origin (`'self'`); `mapbox://` addresses are covered by the fixed Mapbox sources.
 */

function originOf(url: string): string[] {
    return isHttpsUrl(url) ? [new URL(url).origin] : [];
}

/** Tile templates hold `{z}/{x}/{y}` in the path only (the schema requires an https URL), so the origin parses. */
function sourceOrigins(source: LayerSource): string[] {
    switch (source.type) {
        case 'mapbox':
            return [];
        case 'xyz':
            return source.tiles.flatMap(originOf);
        case 'pmtiles':
            return originOf(source.url);
    }
}

function sorted(origins: readonly string[]): string[] {
    return [...new Set(origins)].sort((a, b) => a.localeCompare(b));
}

/** The extra CSP sources of one site: `config.manifestUrl` (relative photos then live there too), tiles, photos, the crash endpoint. */
export function manifestOrigins(manifest: Manifest, config: EngineConfig): ExtraSources {
    const manifestHost = originOf(config.manifestUrl ?? '');
    const tiles = manifest.layers.flatMap((layer) => sourceOrigins(layer.source));
    const photos = manifest.photos.flatMap((photo) => [...originOf(photo.image.web), ...originOf(photo.image.thumb)]);
    const errorEndpoint = originOf(manifest.city.analytics.errorEndpoint ?? '');
    const style = originOf(manifest.city.basemap.style);
    return {
        connect: sorted([...manifestHost, ...tiles, ...errorEndpoint, ...style]),
        images: sorted([...manifestHost, ...tiles, ...photos]),
    };
}

/**
 * M5: the extra CSP sources of a site without a seed manifest, which reads the public bucket's only: the bucket (the
 * manifest and its photos) and the origins the bucket's configuration adds (the crash endpoint). Its layers are the
 * project's Mapbox tilesets, which the fixed Mapbox sources cover.
 */
export function bucketOrigins(config: EngineConfig, connect: readonly string[]): ExtraSources {
    const bucket = originOf(config.manifestUrl ?? '');
    return { connect: sorted([...bucket, ...connect]), images: sorted(bucket) };
}
