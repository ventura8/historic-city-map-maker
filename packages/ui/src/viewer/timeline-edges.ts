/**
 * The scroll hint of a scrolling timeline (the owner, 2026-11-14: "a clear scroll hint"): each edge with years hidden
 * beyond it fades and carries a button that scrolls one page that way and names the furthest year it hides (an arrow over
 * that year: 1847 at the far start, "Today" at the far end). Lying, the start is the earliest year (left, right to left
 * the right); standing, the start is the top, where today is. A button is a 48 px target, in the Tab order and labelled
 * ("Earlier years, back to 1847"). Also here: which lying labels are left out because their neighbour's would touch
 * them (`crowdedLabels`): at the fixed 40 px gap a four-digit year always fits, a long "today" may not.
 */
import { translate, type ViewerLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { TimelineStop } from './timeline-model.js';

export interface Edges {
    readonly start: boolean;
    readonly end: boolean;
}

export type Edge = keyof Edges;

/** The least room between two shown labels, in px. */
const LABEL_ROOM_PX = 4;
/** What a page scroll keeps of the card: the parts the edge buttons cover. */
const PAGE_KEEP_PX = 112;
/** The least a page scroll moves, in px (one year's gap). */
const PAGE_MIN_PX = 40;

/** The edges of a scroller with more content beyond them: its scroll's start and end (right to left the offset is negative). */
export function edgesBeyond(scroller: HTMLElement, vertical: boolean): Edges {
    const along = vertical ? scroller.scrollTop : Math.abs(scroller.scrollLeft);
    const extent = vertical ? scroller.scrollHeight - scroller.clientHeight : scroller.scrollWidth - scroller.clientWidth;
    return { start: along > 1, end: along < extent - 1 };
}

export interface PageWay {
    readonly vertical: boolean;
    readonly rtl: boolean;
    readonly reduced: boolean;
}

/** -1 towards the scroll's start, 1 towards its end, in scroll offsets (lying right to left, the start is the larger offset). */
function direction(edge: Edge, way: PageWay): number {
    const turned = way.rtl && !way.vertical;
    return (edge === 'start') === turned ? 1 : -1;
}

/** Scrolls `scroller` one page towards `edge`: its visible length less what the edge buttons cover; smooth unless reduced motion. */
export function pageTowards(scroller: HTMLElement, edge: Edge, way: PageWay): void {
    const visible = way.vertical ? scroller.clientHeight : scroller.clientWidth;
    const page = direction(edge, way) * Math.max(PAGE_MIN_PX, visible - PAGE_KEEP_PX);
    const behavior: ScrollBehavior = way.reduced ? 'instant' : 'smooth';
    scroller.scrollBy(way.vertical ? { top: page, behavior } : { left: page, behavior });
}

/**
 * The indices of the labels left out so that none touches another, the labels `gap` px apart with these widths. Today
 * (the last) is kept first, then each earlier one that keeps `LABEL_ROOM_PX` from the last one kept.
 */
export function crowdedLabels(widths: readonly number[], gap: number): ReadonlySet<number> {
    const crowded = new Set<number>();
    let edge = Infinity;
    for (let at = widths.length - 1; at >= 0; at -= 1) {
        const half = (widths[at] ?? 0) / 2;
        const centre = at * gap;
        if (centre + half + LABEL_ROOM_PX <= edge) {
            edge = centre - half;
        } else {
            crowded.add(at);
        }
    }
    return crowded;
}

/** Whether two sets hold the same indices. */
export function sameSet(first: ReadonlySet<number>, second: ReadonlySet<number>): boolean {
    return first.size === second.size && [...first].every((at) => second.has(at));
}

export interface EdgeView {
    readonly edges: Edges;
    readonly stops: readonly TimelineStop[];
    readonly vertical: boolean;
    readonly locale: ViewerLocale;
    readonly collapsed: boolean;
    readonly onPage: (edge: Edge) => void;
}

/** The year furthest beyond `edge`: lying, the first year at the start; standing, today (the last stop) at the top. */
function furthest(view: EdgeView, edge: Edge): TimelineStop {
    const earliest = (edge === 'start') !== view.vertical;
    return (earliest ? view.stops[0] : view.stops.at(-1)) ?? null;
}

function icon(edge: Edge, vertical: boolean): string {
    if (vertical) {
        return edge === 'start' ? 'expand_less' : 'expand_more';
    }
    return edge === 'start' ? 'chevron_left' : 'chevron_right';
}

function yearText(stop: TimelineStop, locale: ViewerLocale): string {
    return stop === null ? translate(locale, 'timeline.present') : String(stop);
}

function edgeButton(view: EdgeView, edge: Edge): TemplateResult {
    const stop = furthest(view, edge);
    const year = yearText(stop, view.locale);
    const earlier = (edge === 'start') !== view.vertical;
    const label = translate(view.locale, earlier ? 'timeline.earlier' : 'timeline.later', { year });
    return html`<button
        type="button"
        class="edge edge-${edge}"
        aria-label=${label}
        @click=${() => {
            view.onPage(edge);
        }}
    >
        <hcm-icon name=${icon(edge, view.vertical)}></hcm-icon><span class="edge-year" aria-hidden="true">${year}</span>
    </button>`;
}

function edgeIf(view: EdgeView, edge: Edge): TemplateResult | typeof nothing {
    return view.edges[edge] && !view.collapsed ? edgeButton(view, edge) : nothing;
}

/** The edge buttons of the edges with years beyond them; none on the collapsed pill. */
export function edgeButtons(view: EdgeView): TemplateResult {
    return html`${edgeIf(view, 'start')}${edgeIf(view, 'end')}`;
}
