/**
 * The public viewer engine (docs/ENGINE_API.md): `window.HistoricCityMap` in the IIFE build, the same names in the ES
 * module build. Importing it registers the elements and runs the auto-boot of `config.js` in both builds (a city
 * page may load either; M1-interfaces CR-6). Mapbox GL JS is never bundled: the engine reads the page's global
 * `mapboxgl` (api.mapbox.com, `MAPBOX_GL_VERSION`) when a viewer mounts.
 *
 * This file keeps the release facts and wires the page into `mount.ts`, where every decision is made (and tested in
 * node with fakes).
 */
import './engine.css';

import { createLogger } from '@hcm/shared';
import { defineUiKit, defineViewerElements, setViewerBootstrap } from '@hcm/ui';

import {
    bootDeclaredIn,
    browserEnvironment,
    engineBaseOf,
    mount as mountIn,
    startEngine,
    type HistoricCityMapController,
    type MountEnvironment,
} from './mount.js';
import { setExtrasBase } from './extras/runtime.js';

export type { HistoricCityMapController } from './mount.js';

/** Engine release; the IIFE build exposes it as window.HistoricCityMap.ENGINE_VERSION. */
export const ENGINE_VERSION = '1.0.0-beta.1';

/** Mapbox GL JS version the engine is written against; pages load exactly this one from api.mapbox.com. */
export const MAPBOX_GL_VERSION = '3.34.1';

/** The folder of this script (read now: the IIFE build only knows it while the script runs). */
const ENGINE_BASE = engineBaseOf((import.meta as Partial<ImportMeta>).url, globalThis);
setExtrasBase(ENGINE_BASE);

/** The page's environment, made when a viewer mounts (never at import: the node tests import this file). */
function pageEnvironment(): MountEnvironment {
    const release = { engineVersion: ENGINE_VERSION, mapboxGlVersion: MAPBOX_GL_VERSION, engineBase: ENGINE_BASE };
    return browserEnvironment(window, release, createLogger('engine'));
}

/** `HistoricCityMap.mount(element, config)`: renders a viewer into `element` and returns its controller. */
export function mount(element: Element, config: unknown): HistoricCityMapController {
    return mountIn(element, config, pageEnvironment());
}

/**
 * Registers `<hcm-map-viewer>`, its parts and the kit's elements (idempotent); a `<hcm-map-viewer>` the page declares
 * boots itself from its attributes once connected.
 */
export function defineElements(registry: CustomElementRegistry = customElements): void {
    setViewerBootstrap(bootDeclaredIn(pageEnvironment));
    defineUiKit(registry);
    defineViewerElements(registry);
}

startEngine(globalThis, defineElements, pageEnvironment);
