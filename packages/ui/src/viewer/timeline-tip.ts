/**
 * The timeline's year chip (the owner, 2026-11-13): an M3 plain tooltip that names a year whose stop has no label of its
 * own (a dense track labels every other year). A mouse over such a stop shows it; a finger on the track shows the year
 * under it, clear of the finger (above a lying timeline, beside a standing one), and selects it on lift (`timeline-scrub.ts`).
 * A year of several dates shows no chip at all: its date menu names them. Pure: the text and the place; `<hcm-timeline>`
 * draws it.
 */
import { translate, type ViewerLocale } from '@hcm/shared';

import type { TimelineStop } from './timeline-model.js';

/** Px between the chip and the timeline's card, and between the chip and the viewport's edge. */
const TIP_GAP_PX = 8;

/** What the chip shows: the stop it names, and whether a finger holds it (always shown) or a mouse or key (when needed). */
export interface TimelineTip {
    readonly index: number;
    readonly touch: boolean;
}

/** The chip's text: the year, or "Today". */
export function tipText(stop: TimelineStop, locale: ViewerLocale): string {
    return stop === null ? translate(locale, 'timeline.present') : String(stop);
}

/**
 * Whether a mouse or a key shows the chip on a stop: one without its own label, and never a year of several dates (the
 * owner, 2026-11-13: its date menu names them; the chip would say it twice).
 */
export function tipWanted(labelled: boolean, severalDates: boolean): boolean {
    return !labelled && !severalDates;
}

/** A box: its place and size in px. */
export interface Box {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

function clamp(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(value, Math.max(low, high)));
}

/**
 * Where the chip goes, in the card's coordinates, for a stop at `anchor` (the card's coordinates too): lying, centred
 * above the stop, `TIP_GAP_PX` over the card and never past either end of it nor the viewport's; standing, beside the
 * card on its trailing side (`rtl`: its left), centred on the stop and within the card's height and the viewport's.
 */
export function placeTip(
    anchor: { readonly x: number; readonly y: number },
    tip: { readonly width: number; readonly height: number },
    card: Box,
    viewport: { readonly width: number; readonly height: number; readonly rtl: boolean; readonly vertical: boolean },
): { readonly left: number; readonly top: number } {
    if (viewport.vertical) {
        const left = viewport.rtl ? -tip.width - TIP_GAP_PX : card.width + TIP_GAP_PX;
        const top = clamp(
            anchor.y - tip.height / 2,
            Math.max(0, TIP_GAP_PX - card.top),
            Math.min(card.height, viewport.height - TIP_GAP_PX - card.top) - tip.height,
        );
        return { left, top };
    }
    const low = Math.max(0, TIP_GAP_PX - card.left);
    const high = Math.min(card.width, viewport.width - TIP_GAP_PX - card.left) - tip.width;
    return { left: clamp(anchor.x - tip.width / 2, low, high), top: -tip.height - TIP_GAP_PX };
}
