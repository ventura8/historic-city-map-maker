/**
 * What the Licence and citation panel says (V92; the owner, 2026-11-23): whose rights each layer and photo carries, which
 * layers may be downloaded and from where, and the citation of the view or of one layer. Pure functions, so each rule is
 * tested on its own; the panel (`hcm-licence-panel.ts`) only renders them.
 *
 * Downloads: only the layers we made from U.S. Geological Survey imagery (declassified spy-satellite frames and Landsat),
 * which are in the public domain, offer a file: the PMTiles archive the map itself reads from the city's public bucket.
 * Their GeoTIFF is listed as planned until the pipeline publishes it. A layer made from someone else's scan never offers
 * one: its rights stay with the source its credit names.
 */
import { translate, type Layer, type License, type Photo, type UnplacedPhoto, type ViewerLocale } from '@hcm/shared';

import { resolveAssetUrl } from './services.js';

/** A layer's credit naming the U.S. Geological Survey or Landsat: our own work on public-domain imagery. */
const PUBLIC_DOMAIN_SOURCE = /\bUSGS\b|\bLandsat\b|U\.S\. Geological Survey/i;

export function isPublicDomainLayer(layer: Pick<Layer, 'attribution'>): boolean {
    return PUBLIC_DOMAIN_SOURCE.test(layer.attribution);
}

/** What a layer offers to download: its archive's address, a file still to come, or nothing (a third-party scan). */
export type LayerDownload = { readonly kind: 'pmtiles'; readonly url: string } | { readonly kind: 'planned' } | { readonly kind: 'none' };

export function layerDownload(layer: Pick<Layer, 'attribution' | 'source'>, manifestUrl: string, baseUri: string): LayerDownload {
    if (!isPublicDomainLayer(layer)) {
        return { kind: 'none' };
    }
    const url = layer.source.type === 'pmtiles' ? resolveAssetUrl(layer.source.url, manifestUrl, baseUri) : null;
    return url === null ? { kind: 'planned' } : { kind: 'pmtiles', url };
}

/** How many photos carry each licence, the most common first (ties by the licence's name). */
export function licenceCounts(photos: readonly (Photo | UnplacedPhoto)[]): readonly (readonly [License, number])[] {
    const counts = new Map<License, number>();
    for (const photo of photos) {
        counts.set(photo.license, (counts.get(photo.license) ?? 0) + 1);
    }
    return [...counts].sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b));
}

/** The page's address with `layers=<id>` in its hash (any other `layers=` dropped), so the link opens that layer. */
export function layerLink(href: string, layerId: string): string {
    const [page = '', hash = ''] = href.split('#', 2);
    const parts = hash
        .split('&')
        .filter((part) => part !== '' && !part.startsWith('layers='))
        .concat(`layers=${encodeURIComponent(layerId)}`);
    return `${page}#${parts.join('&')}`;
}

/** The date a citation says the page was seen on, long and in the visitor's language. */
export function accessDate(now: Date, locale: ViewerLocale): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(now);
}

/** What a citation names: the work, the map it is part of, its address and the day it was seen. */
export interface CitationParts {
    readonly title: string;
    readonly map: string;
    readonly url: string;
    readonly date: string;
}

export function citation(parts: CitationParts, locale: ViewerLocale): string {
    return translate(locale, 'cite.text', { ...parts });
}
