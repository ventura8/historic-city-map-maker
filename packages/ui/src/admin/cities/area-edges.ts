/**
 * The New city rectangle's four edges as number fields, the keyboard's way to the area (WCAG 2.1.1; behaviour A50): what
 * is typed stays a draft until all four edges are numbers, which then make the rectangle, so no impossible rectangle is
 * judged edge by edge; clearing one edge keeps the other three (the M5 UX review; `docs/LESSONS.md` 254).
 */
import type { CityBounds } from '@hcm/shared';

export const EDGES = ['west', 'south', 'east', 'north'] as const;

export type Edge = (typeof EDGES)[number];

/** The edges typed so far (a rectangle on screen counts as all four). */
export type EdgeDraft = Readonly<Partial<Record<Edge, number>>>;

/** `current` with `edge` set to the number `text` holds, or without it when `text` is empty or no number. */
export function nextDraft(current: EdgeDraft, edge: Edge, text: string): EdgeDraft {
    const value = Number.parseFloat(text);
    const others = Object.fromEntries(Object.entries(current).filter(([name]) => name !== edge));
    return Number.isFinite(value) ? { ...others, [edge]: value } : others;
}

/** The rectangle once all four edges are numbers, else null. */
export function completeBounds(draft: EdgeDraft): CityBounds | null {
    const { west, south, east, north } = draft;
    return west === undefined || south === undefined || east === undefined || north === undefined ? null : { west, south, east, north };
}
