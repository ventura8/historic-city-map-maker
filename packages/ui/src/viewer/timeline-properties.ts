import { DEFAULT_LOCALE, translate, type ViewerLocale } from '@hcm/shared';
import { LitElement } from 'lit';

import { countOf, datesValueText } from './timeline-dates.js';
import type { Edges } from './timeline-edges.js';
import { YEAR_GAP_PX, type TimelineDensity, type TimelineStop } from './timeline-model.js';
import type { YearOpacity } from './timeline-opacity.js';
import { placeTip, type TimelineTip } from './timeline-tip.js';
import { timelineStyles } from './timeline-styles.js';

export type TimelineOrientation = 'horizontal' | 'vertical';

/** Standing, a label in the pill's lane needs this far from the selected stop: half the 40 px pill and half a 20 px label. */
const PILL_REACH_PX = 30;

export class TimelineProperties extends LitElement {
    static override readonly properties = {
        stops: { attribute: false },
        value: { attribute: false },
        locale: { type: String },
        orientation: { type: String, reflect: true },
        dragging: { type: Boolean, reflect: true },
        density: { type: String, reflect: true },
        fade: { state: true },
        crowded: { state: true },
        collapsed: { type: Boolean, reflect: true },
        dateCounts: { attribute: false },
        tip: { state: true },
        said: { state: true },
        opacity: { attribute: false },
    };

    static override readonly styles = timelineStyles;

    declare stops: readonly TimelineStop[];
    declare value: TimelineStop;
    declare locale: ViewerLocale;
    declare orientation: TimelineOrientation;
    declare dragging: boolean;
    /** How the years fit the card (reflected for the styles), from the card's size and the number of stops. */
    declare density: TimelineDensity;
    /** The edges with more years beyond them: the scroll's start (left, right right to left, top standing) and end. */
    declare fade: Edges;
    /** Lying, the stops whose label is left out: it would touch its neighbour's (`crowdedLabels`). */
    declare crowded: ReadonlySet<number>;
    /** V12: on a phone, idle, the card is only its year's pill (the viewer's `timeline-dock.ts` decides). */
    declare collapsed: boolean;
    /** V13: the years with several dates, and how many (`timeline-dates.ts`): their stops carry a badge. */
    declare dateCounts: ReadonlyMap<number, number>;
    /** The year chip, or null. */
    declare tip: TimelineTip | null;
    /** What the polite live region says: the year a drag or a scrub ended on (the slider's own value text while it moves). */
    declare said: string;
    /** The selected year's front layer, whose opacity the card above the thumb changes (`timeline-opacity.ts`); null: none. */
    declare opacity: YearOpacity | null;

    constructor() {
        super();
        this.stops = [null];
        this.value = null;
        this.locale = DEFAULT_LOCALE;
        this.orientation = 'horizontal';
        this.dragging = false;
        this.density = 'roomy';
        this.fade = { start: false, end: false };
        this.crowded = new Set();
        this.collapsed = false;
        this.dateCounts = new Map();
        this.tip = null;
        this.said = '';
        this.opacity = null;
    }

    /**
     * `tipping` while the chip shows (none on the collapsed pill), `tipping="focus"` when it is the keyboard's: the
     * photos chip under it then stays in the Tab order (`dock-styles.ts`, lesson 648).
     */
    protected markTipping(): void {
        this.removeAttribute('tipping');
        if (this.#tipShows()) {
            this.setAttribute('tipping', this.#keyboardTip() ? 'focus' : '');
        }
    }

    /** The year chip or the opacity card shows above the thumb: the photos chip under them steps aside. */
    #tipShows(): boolean {
        return (this.tip !== null || this.renderRoot.querySelector('.opacity:not([hidden])') !== null) && !this.collapsed;
    }

    /** The chip is the keyboard's: the thumb has a visible focus and no finger is down. */
    #keyboardTip(): boolean {
        return this.tip?.touch === false && this.renderRoot.querySelector('.thumb:focus-visible') !== null;
    }

    /** Puts the chip by its stop, clear of the card's ends and the viewport's edges (`placeTip`). */
    protected placeTip(): void {
        const tip = this.renderRoot.querySelector<HTMLElement>('.tip');
        const stop = this.renderRoot.querySelectorAll('.stop')[this.tip?.index ?? -1];
        if (tip === null || stop === undefined) {
            return;
        }
        const card = this.getBoundingClientRect();
        const mark = stop.getBoundingClientRect();
        const anchor = { x: mark.left + mark.width / 2 - card.left, y: mark.top + mark.height / 2 - card.top };
        const rtl = this.matches(':dir(rtl)');
        const viewport = { width: innerWidth, height: innerHeight, rtl, vertical: this.orientation === 'vertical' };
        const place = placeTip(anchor, { width: tip.offsetWidth, height: tip.offsetHeight }, card, viewport);
        tip.style.left = `${String(place.left)}px`;
        tip.style.top = `${String(place.top)}px`;
    }

    /** Whether a stop shows its year: every one lying; standing, not under the pill (the pill names the selected year). */
    protected labelled(stopAt: number, selected: number): boolean {
        return this.orientation !== 'vertical' || stopAt === selected || Math.abs(stopAt - selected) * YEAR_GAP_PX >= PILL_REACH_PX;
    }

    protected percent(index: number): number {
        const last = this.stops.length - 1;
        return last > 0 ? (index / last) * 100 : 0;
    }

    protected shortLabel(stop: TimelineStop): string {
        return stop === null ? translate(this.locale, 'timeline.present') : String(stop);
    }

    protected valueText(stop: TimelineStop): string {
        if (stop === null) {
            return translate(this.locale, 'timeline.present');
        }
        return datesValueText(this.locale, translate(this.locale, 'timeline.year', { year: String(stop) }), countOf(this.dateCounts, stop));
    }
}
