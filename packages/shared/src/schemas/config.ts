/**
 * The embed configuration a city page gives the engine (docs/ENGINE_API.md → config.js):
 * `window.HistoricCityMapConfig`, the `<hcm-map-viewer>` attributes, or the second argument of
 * `HistoricCityMap.mount(element, config)`. The starter kit's `config.js` is validated against it.
 */
import { z } from 'zod';

import { assetUrlSchema, coded, idSchema } from './primitives.js';

/** Where the engine mounts when the configuration names no container. */
export const DEFAULT_CONTAINER_SELECTOR = '#historic-city-map';

/** A BCP 47 tag; the engine resolves it with `resolveLocale` (anything but English becomes Romanian). */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;

export const engineConfigSchema = z
    .strictObject({
        /** Optional cross-check: when present it must equal the manifest's `city.id` (it also namespaces stored preferences). */
        cityId: idSchema.optional(),
        /** https or relative (to the page) address of the manifest JSON. */
        manifestUrl: assetUrlSchema.optional(),
        /** An inline manifest (starter kit, no backend); validated like a fetched one. */
        manifest: z.unknown().optional(),
        /** CSS selector of the element to mount into (the auto-boot of `config.js` only). */
        container: z.string().trim().min(1).max(200).optional(),
        lang: z.string().regex(LANGUAGE_TAG).optional(),
        /** Where the engine's own assets (CSS, fonts, icons) live, ending with `/`; default: next to the engine script. */
        engineBase: assetUrlSchema.refine((base) => base.endsWith('/'), coded('validation.format')).optional(),
    })
    .refine((config) => (config.manifestUrl === undefined) !== (config.manifest === undefined), coded('validation.manifestSource'));

export type EngineConfig = z.infer<typeof engineConfigSchema>;
