/**
 * The places page's texts (docs/research/M2c-interfaces.md §10.1): every word comes from the editors' catalogue
 * (`adminContent.pois.*`, `adminContent.map.*`), the editing kit's own words for a required field, or the viewer's validation
 * messages (`validation.*`); titles, labels and
 * imported texts are data, shown as text only.
 */
import type { AdminContentKey, UiLocale, ValidationIssue } from '@hcm/shared';

import { issueText as fieldIssueText } from '../editing/issue-text.js';
import { contentText } from '../shell/text.js';
import type {
    CategoryItemPort,
    DrawRefusalKindPort,
    ImportRefusalReasonPort,
    PoiItemPort,
    PoiShapePort,
    PoiTextPort,
} from './pois-port.js';

type Params = Readonly<Record<string, string>>;

export function poiText(locale: UiLocale, key: AdminContentKey, params?: Params): string {
    return contentText(locale, key, params);
}

/** The address of a place's editor. */
export function poiHref(poiId: string): string {
    return ['#', 'pois', poiId].join('/');
}

/** The address of a place's history. */
export function poiHistoryHref(poiId: string): string {
    return ['#', 'history', 'poi', poiId].join('/');
}

/** A text in the admin's language, Romanian when English is missing (as the viewer does). */
export function localized(locale: UiLocale, text: PoiTextPort): string {
    return locale === 'en' ? (text.en ?? text.ro) : text.ro;
}

export const SHAPE_KEYS: Readonly<Record<PoiShapePort, AdminContentKey>> = {
    point: 'adminContent.pois.shape.point',
    linestring: 'adminContent.pois.shape.linestring',
    polygon: 'adminContent.pois.shape.polygon',
};

/** A list row's shape as the editor names it. */
export const ROW_SHAPES: Readonly<Record<PoiItemPort['shape'], PoiShapePort>> = { point: 'point', line: 'linestring', area: 'polygon' };

/** A place's years: a span, an open start or end, or none. */
export function yearsText(locale: UiLocale, start: number | null, end: number | null): string {
    if (start !== null && end !== null) {
        return poiText(locale, 'adminContent.pois.years', { from: String(start), to: String(end) });
    }
    if (start !== null) {
        return poiText(locale, 'adminContent.pois.yearsFrom', { from: String(start) });
    }
    return end === null ? poiText(locale, 'adminContent.pois.undated') : poiText(locale, 'adminContent.pois.yearsTo', { to: String(end) });
}

/** A category's label in the admin's language, or "Unknown category". */
export function categoryName(locale: UiLocale, categories: readonly CategoryItemPort[], id: string): string {
    const category = categories.find((item) => item.id === id);
    return category === undefined ? poiText(locale, 'adminContent.pois.unknownCategory') : localized(locale, category.label);
}

/** What the map refused, said once. */
export function refusalText(locale: UiLocale, kind: DrawRefusalKindPort): string {
    return poiText(locale, `adminContent.map.refused.${kind}`);
}

/** Why an imported feature was refused. */
export function reasonText(locale: UiLocale, reason: ImportRefusalReasonPort, path: string | null): string {
    return poiText(locale, `adminContent.pois.import.reason.${reason}`, { path: path ?? '' });
}

/** A field's problem: the action a required field asks for, else the viewer's validation words (`../editing/issue-text.ts`). */
export function issueText(locale: UiLocale, issue: ValidationIssue): string {
    return fieldIssueText(locale, issue);
}

/** The first problem of a field (its path, or a path below it). */
export function fieldIssue(issues: readonly ValidationIssue[], field: string): ValidationIssue | undefined {
    return issues.find((issue) => issue.path === field || issue.path.startsWith(`${field}.`) || issue.path.startsWith(`${field}[`));
}
