/**
 * The new city's `city.json` (`docs/research/M5-interfaces.md` §4.3): the template's manifest with the owner's name,
 * rectangle, start view (`startViewForBounds`), theme (`themeFromSeed` of the seed) and token. The template's example
 * places move with the city (the same offsets from its centre), so the example still shows; About names the city. The
 * result is validated as the engine validates it, and refused (nothing written) if it does not pass.
 */
import { startViewForBounds, validateManifest, type CityBounds, type Geometry, type Manifest } from '@hcm/shared';
import type { ThemeTokenSet } from '@hcm/ui/dynamic-color';

import { Refusal } from './context.js';
import type { Translate } from './i18n/index.js';

export interface CityAnswers {
    readonly id: string;
    readonly name: { readonly ro: string; readonly en: string };
    readonly bounds: CityBounds;
    readonly seed: string;
    readonly token: string;
}

type Position = [number, number];

const DECIMALS = 1e6;

const round = (value: number): number => Math.round(value * DECIMALS) / DECIMALS;

function shifted([lng, lat]: readonly number[], offset: Position): Position {
    return [round(Number(lng) + offset[0]), round(Number(lat) + offset[1])];
}

/** `geometry` moved by `offset` degrees. */
function moved(geometry: Geometry, offset: Position): Geometry {
    switch (geometry.type) {
        case 'Point':
            return { type: 'Point', coordinates: shifted(geometry.coordinates, offset) };
        case 'LineString':
            return { type: 'LineString', coordinates: geometry.coordinates.map((position) => shifted(position, offset)) };
        case 'Polygon':
            return { type: 'Polygon', coordinates: geometry.coordinates.map((ring) => ring.map((position) => shifted(position, offset))) };
    }
}

/** A name written into Markdown as plain text (`\` before the subset's markup characters). */
function markdownText(name: string): string {
    return name.replace(/[\\*_[\]]/g, (character) => `\\${character}`);
}

/** The template's About with its example name replaced by the city's. */
function renamedAbout(template: Manifest['city'], name: CityAnswers['name']): Manifest['city']['about'] {
    return {
        ro: template.about.ro.replaceAll(template.name.ro, markdownText(name.ro)),
        en: template.about.en.replaceAll(template.name.en, markdownText(name.en)),
    };
}

function cityOf(template: Manifest['city'], answers: CityAnswers, theme: ThemeTokenSet): Manifest['city'] {
    const { west, south, east, north } = answers.bounds;
    const view = startViewForBounds(answers.bounds);
    return {
        ...template,
        id: answers.id,
        name: { ro: answers.name.ro, en: answers.name.en },
        center: [round(view.center.lng), round(view.center.lat)],
        zoom: view.zoom,
        minZoom: view.minZoom,
        maxZoom: view.maxZoom,
        bounds: [
            [west, south],
            [east, north],
        ],
        about: renamedAbout(template, answers.name),
        theme: { seedColor: answers.seed, tokens: theme },
        mapbox: { publicToken: answers.token },
    };
}

function parsedTemplate(text: string): Manifest {
    const result = validateManifest(JSON.parse(text));
    if (!result.ok) {
        throw new Error(`the bundled template/city.json is invalid: ${JSON.stringify(result.issues[0])}`);
    }
    return result.value;
}

/** The new city's manifest as `city.json` text; a city the engine would refuse throws `Refusal` (the first issue). */
export function cityManifestText(templateText: string, answers: CityAnswers, theme: ThemeTokenSet, t: Translate): string {
    const template = parsedTemplate(templateText);
    const city = cityOf(template.city, answers, theme);
    const offset: Position = [city.center[0] - template.city.center[0], city.center[1] - template.city.center[1]];
    const pois = (template.pois ?? []).map((poi) => ({ ...poi, geometry: moved(poi.geometry, offset) }));
    const manifest: Manifest = { ...template, city, pois };
    const result = validateManifest(manifest);
    if (!result.ok) {
        const detail = result.issues
            .slice(0, 1)
            .map((issue) => `${issue.path} ${issue.code}`)
            .join('');
        throw new Refusal(t('cli.manifest.invalid', { detail }));
    }
    return `${JSON.stringify(manifest, null, 4)}\n`;
}
