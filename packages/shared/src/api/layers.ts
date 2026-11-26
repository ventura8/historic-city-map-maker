/**
 * Historical layers the admin removes or links (`docs/research/M2c-interfaces.md` §8.1, §8.4; CR-M2c-3, CR-M2c-27;
 * scenarios A15, A33). Layers are otherwise created by the raster pipeline (M3), so no client creates or deletes a layer
 * document: `layers.link` adds a layer over a tileset or tile address that already exists, after the checks below, and
 * `layers.delete` removes one and queues the deletion of its Mapbox tileset after a grace period, during which a revert
 * from History brings it back.
 */
import { z } from 'zod';

import { MAX_ID_LENGTH, slugify, truncateSlug } from '../migration/slug.js';
import { sha256Schema } from '../schemas/firestore-common.js';
import { LAYER_KINDS, layerSourceSchema, type LayerSource } from '../schemas/manifest.js';
import { cityIdSchema } from '../schemas/paths.js';
import {
    PHOTOS_OVERLAY_ID,
    boundsRecordSchema,
    coded,
    idSchema,
    localizedPartial,
    plainText,
    yearSchema,
    zoomSchema,
} from '../schemas/primitives.js';
import { isoTimeSchema } from './common.js';

/** Days between a layer's deletion and the deletion of its Mapbox tileset (a restore within them cancels it). */
export const LAYER_DELETE_GRACE_DAYS = 7;

/** `layers.delete` (admin): the layer goes now, its tileset after the grace. */
export const layerDeleteRequestSchema = z.strictObject({ cityId: cityIdSchema, layerId: idSchema });

export const layerDeleteResponseSchema = z.strictObject({
    /** The `layer-delete` job waiting in `cities/{city}/jobs`. */
    jobId: idSchema,
    /** When the job may run (`dispatchAt`): the deletion time plus the grace. */
    runsAt: isoTimeSchema,
});

/** The `params` of a `layer-delete` job: what the dispatcher (M3, CR-M2c-13) deletes unless the layer is back. */
export const layerDeleteParamsSchema = z.strictObject({
    layerId: idSchema,
    tilesetId: z.string().max(100).optional(),
    sourceSha: sha256Schema.optional(),
});

/** The sources a layer may be linked to; a PMTiles archive arrives with the raster pipeline. */
export const LINKABLE_SOURCE_TYPES = ['mapbox', 'xyz'] as const;

const linkableSourceSchema = layerSourceSchema.refine(
    (source) => (LINKABLE_SOURCE_TYPES as readonly string[]).includes(source.type),
    coded('validation.value', ['type']),
);

/** `layers.link` (admin): a new, unpublished, ready layer over an existing tileset or tile address. */
export const layerLinkRequestSchema = z
    .strictObject({
        cityId: cityIdSchema,
        source: linkableSourceSchema,
        label: localizedPartial(200),
        year: yearSchema,
        kind: z.enum(LAYER_KINDS),
        attribution: plainText(500).optional(),
        minzoom: zoomSchema.optional(),
        maxzoom: zoomSchema.optional(),
        bounds: boundsRecordSchema.optional(),
    })
    .refine((request) => (request.minzoom ?? 0) <= (request.maxzoom ?? 24), coded('validation.zoomRange', ['maxzoom']));

export const layerLinkResponseSchema = z.strictObject({ layerId: idSchema });

/** Why a source cannot be linked, before anything is written (the admin's dialog and `layers.link` share these). */
export type LayerSourceRefusal =
    | { readonly code: 'apiError.layers.foreignTileset'; readonly params: { readonly owner: string } }
    | { readonly code: 'apiError.layers.secretInAddress' }
    | { readonly code: 'apiError.mapbox.notConfigured' };

/** Query parameters and path parts that carry a credential (a tile address is published in the manifest). */
const CREDENTIAL = /(?:[?&](?:access_token|token|key|apikey|api_key|signature|sig)=)|(?:\b[sp]k\.[\w-]{20,})/i;

/** `/v4/<owner>.<tileset>/…` on a Mapbox tile host: a tile address that is a Mapbox tileset. */
const MAPBOX_TILE_PATH = /^\/v4\/([a-z0-9_-]{1,32})\.[A-Za-z0-9_-]{1,64}(?:[./]|$)/;

/** The Mapbox account that owns a source, when it is a Mapbox tileset (by id or by its tile address). */
export function tilesetOwnerOf(source: LayerSource): string | null {
    if (source.type === 'mapbox') {
        return source.tilesetId.slice(0, source.tilesetId.indexOf('.'));
    }
    const urls = source.type === 'xyz' ? source.tiles : [source.url];
    for (const url of urls) {
        const owner = mapboxTileOwner(url);
        if (owner !== null) {
            return owner;
        }
    }
    return null;
}

/** Mapbox's tile hosts: `api.mapbox.com` and the older `{a,b,c,d}.tiles.mapbox.com`. */
function isMapboxTileHost(hostname: string): boolean {
    return hostname === 'api.mapbox.com' || hostname === 'tiles.mapbox.com' || hostname.endsWith('.tiles.mapbox.com');
}

/** The path with its escapes undone (`mapbox%2Esatellite` is `mapbox.satellite` to Mapbox); a broken escape stays as is. */
function decodedPath(pathname: string): string {
    try {
        return decodeURIComponent(pathname);
    } catch {
        return pathname;
    }
}

/** The decoded path of a Mapbox tile address, or null for any other address. */
function mapboxTilePath(url: string): string | null {
    const parsed = URL.canParse(url) ? new URL(url) : null;
    return parsed !== null && isMapboxTileHost(parsed.hostname) ? decodedPath(parsed.pathname) : null;
}

function mapboxTileOwner(url: string): string | null {
    const path = mapboxTilePath(url);
    const match = path === null ? null : MAPBOX_TILE_PATH.exec(path);
    return match?.[1] ?? null;
}

function addressesOf(source: LayerSource): readonly string[] {
    if (source.type === 'mapbox') {
        return [];
    }
    return source.type === 'xyz' ? source.tiles : [source.url];
}

/**
 * The first reason `source` cannot be linked to a city whose Mapbox account is `mapboxUser` (null when the city has none
 * yet): a credential inside a tile address (it would be published), or a Mapbox tileset of another account, the
 * `mapbox.*` tilesets (Satellite among them) and every resource of the old site's account included (`AGENTS.md`: hard
 * constraints). Null when it may be linked.
 */
export function layerSourceRefusal(source: LayerSource, mapboxUser: string | null): LayerSourceRefusal | null {
    if (addressesOf(source).some((url) => CREDENTIAL.test(url))) {
        return { code: 'apiError.layers.secretInAddress' };
    }
    const owner = tilesetOwnerOf(source);
    if (owner === null) {
        return null;
    }
    if (mapboxUser === null) {
        return { code: 'apiError.mapbox.notConfigured' };
    }
    return owner === mapboxUser ? null : { code: 'apiError.layers.foreignTileset', params: { owner } };
}

/** The https origins a source's tiles come from (none for a Mapbox tileset: the sites allow Mapbox already). */
export function sourceOrigins(source: LayerSource): readonly string[] {
    const origins = addressesOf(source)
        .filter((url) => URL.canParse(url) && mapboxTileOwner(url) === null)
        .map((url) => new URL(url).origin);
    return [...new Set(origins)];
}

/**
 * A free id in the overlay namespace for an overlay labelled `label`: historical layers, `photos` and the POI categories
 * share one namespace (the manifest refuses a duplicate id: S-A39-BAD-ID-CLASH), so the slug of the Romanian label gets
 * `-2`, `-3`, ... while it is `photos` or in `taken`; `fallback` when the label has no letter or digit.
 */
export function freeOverlayId(label: string, taken: ReadonlySet<string>, fallback: string): string {
    const root = truncateSlug(slugify(label) || fallback, MAX_ID_LENGTH);
    let id = root;
    let suffix = 1;
    while (taken.has(id) || id === PHOTOS_OVERLAY_ID) {
        suffix += 1;
        id = `${truncateSlug(root, MAX_ID_LENGTH - String(suffix).length - 1)}-${String(suffix)}`;
    }
    return id;
}

export type LayerDeleteRequest = z.infer<typeof layerDeleteRequestSchema>;
export type LayerDeleteResponse = z.infer<typeof layerDeleteResponseSchema>;
export type LayerDeleteParams = z.infer<typeof layerDeleteParamsSchema>;
export type LayerLinkRequest = z.infer<typeof layerLinkRequestSchema>;
export type LayerLinkResponse = z.infer<typeof layerLinkResponseSchema>;
