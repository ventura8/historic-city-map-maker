/**
 * The admin map's factory as the entry builds it (`../app/content-wiring.ts`, the pois section): Mapbox GL JS from
 * api.mapbox.com on the first map, the admin's token read from `setup/status` for every new map (Setup may have minted
 * it since the last one), reduced motion from the page, Terra Draw loaded with the first drawing tools (`terraDraw`:
 * docs/research/M2c-interfaces.md §4.2, DECISIONS-for-review.md §34g; the click-only tools without it), and the page's
 * animation frames, resize observer and canvas.
 */
import { FIRESTORE_PATHS, type Logger } from '@hcm/shared';
import { browserAdapterEnv, loadMapboxGl, type BrowserScope, type MapboxLoaderScope } from '@hcm/ui/map';
import type { TerraDrawModules } from '@hcm/ui/map/draw';

import { createAdminMapFactory, type AdminMapFactory } from './factory.js';

/** A Mapbox public token, as `setup/status` keeps the admin's (a secret `sk.` token never passes). */
const PUBLIC_TOKEN = /^pk\.[A-Za-z0-9._-]{1,1000}$/;

/** The page's parts the map needs. */
export type AdminMapScope = MapboxLoaderScope & BrowserScope & { matchMedia?(query: string): { readonly matches: boolean } };

export interface AdminMapSources {
    readonly scope: AdminMapScope;
    /** A Firestore document's fields, or null (`DocumentsPort.get`). */
    readonly readDoc: (path: string) => Promise<Readonly<Record<string, unknown>> | null>;
    /** Terra Draw's lazy loader (`loadTerraDraw` of `@hcm/ui/map/draw`); null: the click-only tools. */
    readonly terraDraw: (() => Promise<TerraDrawModules>) | null;
    readonly log: Logger;
    /**
     * The `e2e` build's token for its own city (`?mapToken=`, CR-M2c-7): a test's city then needs no `setup/status`, which the
     * Setup Assistant's specs rewrite; null is no token at all (the city has no map), and a value that is not a public token
     * is none either. Undefined (always in production: `E2E_KIT` is null there) reads `setup/status`.
     */
    readonly fixedToken?: string | null | undefined;
}

function objectAt(value: unknown, key: string): unknown {
    return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>)[key] : undefined;
}

/** `setup/status.mapbox.adminToken`, or null when Setup has not minted it (or the read failed). */
export async function adminTokenOf(readDoc: AdminMapSources['readDoc'], log: Logger): Promise<string | null> {
    try {
        const token = objectAt(objectAt(await readDoc(FIRESTORE_PATHS.setupStatus), 'mapbox'), 'adminToken');
        return typeof token === 'string' && PUBLIC_TOKEN.test(token) ? token : null;
    } catch (error) {
        log.warn('setup status unreadable: no admin map', { error: String(error) });
        return null;
    }
}

/**
 * M13 §8: a moderator or an uploader reads no `setup/status`: the map then wears the city's public token, which the viewer
 * uses and every role of the city may read.
 */
export async function cityTokenOf(readDoc: AdminMapSources['readDoc'], cityId: string | undefined): Promise<string | null> {
    if (cityId === undefined) {
        return null;
    }
    try {
        const token = objectAt(objectAt(await readDoc(FIRESTORE_PATHS.city(cityId)), 'mapbox'), 'publicToken');
        return typeof token === 'string' && PUBLIC_TOKEN.test(token) ? token : null;
    } catch {
        return null;
    }
}

/** Where the map's token comes from: `setup/status`, else the city's (production), or the `e2e` build's fixed token or none. */
function tokenSource(sources: AdminMapSources): (cityId?: string) => Promise<string | null> {
    const fixed = sources.fixedToken;
    if (fixed === undefined) {
        return async (cityId) => (await adminTokenOf(sources.readDoc, sources.log)) ?? cityTokenOf(sources.readDoc, cityId);
    }
    const token = fixed !== null && PUBLIC_TOKEN.test(fixed) ? fixed : null;
    return () => Promise.resolve(token);
}

export function adminMapFactoryOf(sources: AdminMapSources): AdminMapFactory {
    const { scope, log } = sources;
    return createAdminMapFactory({
        gl: () => loadMapboxGl(scope),
        token: tokenSource(sources),
        terraDraw: sources.terraDraw,
        reducedMotion: () => scope.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
        env: browserAdapterEnv(scope),
        log,
    });
}
