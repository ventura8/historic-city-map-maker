/**
 * A field's value in a history entry, as text (`docs/research/M2c-interfaces.md` §9.2, §10.3): what was stored is shown
 * without ever being rendered as markup, and in a form an admin reads: a title in both languages, a geometry as its type
 * and position count, an opacity or an image adjustment as a percentage, a theme as its seed colour, a place as its
 * coordinates, a list as its length, a timestamp as a date. Anything else is its JSON, cut to 200 characters.
 */
import type { UiLocale } from '@hcm/shared';

import { contentText } from '../shell/text.js';
import { formatWhen } from '../editing/states.js';

type Describer = (locale: UiLocale, field: string, value: unknown) => string | null;

const MAX_TEXT = 200;

/** Fields stored as a share of one (0–1) and shown as a percentage. */
const PERCENT_FIELDS = new Set(['opacity', 'defaultOpacity']);

/** Fields holding a year, shown without a thousands separator (1980, never "1,980"). */
const YEAR_FIELDS = new Set(['year', 'yearEnd', 'yearStart', 'yearSeen']);

/** A geometry's type in the admin's words (the place editor's shape names); an unknown type as stored. */
const SHAPE_KEYS: Readonly<Record<string, Parameters<typeof contentText>[1]>> = {
    Point: 'adminContent.pois.shape.point',
    LineString: 'adminContent.pois.shape.linestring',
    Polygon: 'adminContent.pois.shape.polygon',
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function percent(locale: UiLocale, share: number): string {
    return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(share);
}

const absent: Describer = (locale, _field, value) =>
    value === undefined || value === null ? contentText(locale, 'adminContent.history.value.none') : null;

const boolean: Describer = (locale, _field, value) => {
    if (typeof value !== 'boolean') {
        return null;
    }
    return contentText(locale, value ? 'adminContent.history.value.yes' : 'adminContent.history.value.no');
};

const number: Describer = (locale, field, value) => {
    if (typeof value !== 'number') {
        return null;
    }
    if (PERCENT_FIELDS.has(field)) {
        return percent(locale, value);
    }
    return new Intl.NumberFormat(locale, { useGrouping: !YEAR_FIELDS.has(field) }).format(value);
};

const text: Describer = (_locale, _field, value) => (typeof value === 'string' ? value.slice(0, MAX_TEXT * 5) : null);

const timestamp: Describer = (locale, _field, value) => {
    if (!isRecord(value) || typeof value['seconds'] !== 'number' || typeof value['nanoseconds'] !== 'number') {
        return null;
    }
    return formatWhen(locale, new Date(value['seconds'] * 1000).toISOString());
};

const localized: Describer = (_locale, _field, value) => {
    if (!isRecord(value) || typeof value['ro'] !== 'string') {
        return null;
    }
    return typeof value['en'] === 'string' ? `RO: ${value['ro']} · EN: ${value['en']}` : `RO: ${value['ro']}`;
};

function positionsOf(geometry: Readonly<Record<string, unknown>>): number {
    if (geometry['type'] === 'Point') {
        return 1;
    }
    if (Array.isArray(geometry['points'])) {
        return geometry['points'].length;
    }
    const rings = Array.isArray(geometry['rings']) ? (geometry['rings'] as readonly unknown[]) : [];
    return rings.reduce<number>((sum, ring) => sum + (isRecord(ring) && Array.isArray(ring['points']) ? ring['points'].length : 0), 0);
}

const geometry: Describer = (locale, field, value) => {
    if (field !== 'geometry' || !isRecord(value) || typeof value['type'] !== 'string') {
        return null;
    }
    const shape = SHAPE_KEYS[value['type']];
    const type = shape === undefined ? value['type'] : contentText(locale, shape);
    return contentText(locale, 'adminContent.history.value.geometry', { type, count: String(positionsOf(value)) });
};

const adjustments: Describer = (locale, field, value) => {
    if (field !== 'adjustments' || !isRecord(value)) {
        return null;
    }
    const parts = Object.entries(value).map(([name, share]) => `${name} ${typeof share === 'number' ? percent(locale, share) : '?'}`);
    return parts.length === 0 ? contentText(locale, 'adminContent.history.value.none') : parts.join(', ');
};

const theme: Describer = (locale, field, value) => {
    if (field !== 'theme' || !isRecord(value) || typeof value['seedColor'] !== 'string') {
        return null;
    }
    return contentText(locale, 'adminContent.history.value.theme', { color: value['seedColor'] });
};

const position: Describer = (locale, _field, value) => {
    if (!isRecord(value) || typeof value['lat'] !== 'number' || typeof value['lng'] !== 'number') {
        return null;
    }
    const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 5 });
    return `${format.format(value['lat'])}, ${format.format(value['lng'])}`;
};

const list: Describer = (locale, _field, value) =>
    Array.isArray(value) ? contentText(locale, 'adminContent.history.value.items', { count: String(value.length) }) : null;

/** Anything else: its JSON, cut short. */
function json(value: unknown): string {
    const encoded = JSON.stringify(value);
    return encoded.length > MAX_TEXT ? `${encoded.slice(0, MAX_TEXT)}…` : encoded;
}

const DESCRIBERS: readonly Describer[] = [
    absent,
    boolean,
    number,
    text,
    timestamp,
    localized,
    geometry,
    adjustments,
    theme,
    position,
    list,
];

/** The value of `field`, as text in `locale`. */
export function describeValue(locale: UiLocale, field: string, value: unknown): string {
    for (const describe of DESCRIBERS) {
        const described = describe(locale, field, value);
        if (described !== null) {
            return described;
        }
    }
    return json(value);
}
