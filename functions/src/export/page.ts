/**
 * The export's `index.html` (M5, `docs/research/M5-interfaces.md` §5.1): the starter kit's committed page filled by
 * `fillKitPage` of `@hcm/shared` for the exported city, with the engine beside it (`engine/`, no CDN) and `city.json`
 * next to it. Its meta CSP names the origins the exported manifest still points at (tile servers, a PMTiles archive, a
 * photo kept at an outside address, an https basemap style) besides the fixed Mapbox and engine sources; an origin a
 * policy cannot name as one source (a host with `;` or `'`, which a WHATWG URL allows) is left out, so a city editor's
 * basemap address never adds a directive (`docs/LESSONS.md` 241). The export's manifest carries no analytics id, so
 * the policy names none of the telemetry's hosts.
 */
import { EXPORT_LAYOUT, fillKitPage, isCspOrigin, isHttpsUrl, type ExtraSources, type LayerSource, type Manifest } from '@hcm/shared';

/** The https addresses a layer's source names (a `mapbox://` tileset is covered by the fixed Mapbox sources). */
function layerAddresses(source: LayerSource): readonly string[] {
    if (source.type === 'xyz') {
        return source.tiles;
    }
    return source.type === 'pmtiles' ? [source.url] : [];
}

/** The distinct origins of the https addresses among `urls`, in order (a relative address is the page's own). */
function originsOf(urls: readonly string[]): string[] {
    const origins = urls.filter((url) => isHttpsUrl(url)).map((url) => new URL(url).origin);
    return [...new Set(origins)].filter((origin) => isCspOrigin(origin)).sort((a, b) => a.localeCompare(b));
}

/** The origins outside the export that its manifest makes the browser contact (relative addresses are its own). */
export function exportSources(manifest: Manifest): ExtraSources {
    const tiles = manifest.layers.flatMap((layer) => layerAddresses(layer.source));
    const images = manifest.photos.flatMap((photo) => [photo.image, photo.versions?.improved, photo.versions?.colorized]);
    const photos = images.flatMap((image) => (image === undefined ? [] : [image.web, image.thumb]));
    return { connect: originsOf([...tiles, manifest.city.basemap.style]), images: originsOf([...tiles, ...photos]) };
}

/**
 * The kit's page for the exported city: its name, its colour, Romanian first, the engine from `engine/`, and its own tab
 * icon inlined when it has one (`icon`, a `data:` address; else the kit's default stays).
 */
export function exportPage(template: string, manifest: Manifest, icon?: string): string {
    const { city } = manifest;
    return fillKitPage(template, {
        engine: { kind: 'local' },
        lang: 'ro',
        title: city.name.ro,
        heading: city.name.ro,
        description: `${city.name.ro}: hartă istorică, fotografii vechi și locuri dispărute pe harta de azi.`,
        themeColor: city.theme.seedColor,
        manifestUrl: EXPORT_LAYOUT.manifest,
        sources: exportSources(manifest),
        analytics: false,
        ...(icon === undefined ? {} : { icon }),
    });
}
