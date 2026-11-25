/**
 * `<hcm-timeline>`: the year scrubber, the viewer's hero moment (scenario V04). Its stops are the layer years plus
 * "today"; any position snaps to a stop. One `role="slider"` thumb carries the keyboard and screen-reader path
 * (arrows, Page Up/Down, Home, End; `aria-valuetext` is the localized year); the track takes pointer drags and taps.
 * The thumb morphs from a pill into a rounded square while it is dragged (an expressive spring curve), with no
 * motion under `prefers-reduced-motion: reduce`. Standing on the leading edge of a phone held upright, lying at the bottom
 * of the map everywhere else; Left and Right follow the thumb on screen (a later year is to the left, right to left).
 * The track fits the card (the Pixel Tablet, 2026-11-12: at 30 px per gap twenty-two years overflowed it and clipped the
 * first; the owner, 2026-11-14: "too crowded", "way nuked", then a smaller gap with dots): every year is a label exactly
 * 40 px apart at every width from the card's leading edge (`YEAR_GAP_PX`), lying a dot on the rail too (the selected
 * year's bigger, under the pill), a label that would touch its neighbour's left out (`crowdedLabels`); where they do not
 * fit the card scrolls, a finger, a mouse's drag or wheel can scroll it, and each edge with years beyond fades and carries
 * a button that pages that way and names the furthest year it hides (`timeline-edges.ts`). The selected stop is centred
 * on load, when the card opens from its pill and whenever the year changes from outside, never after a pointer chose it
 * (`timeline-model.ts`, `timeline-styles.ts`). There a finger drags the thumb and taps a year; elsewhere it drags anywhere on the track.
 * A new stop fires `hcm-year-change` (`{year}`, null for today). The year chip (`timeline-tip.ts`) names a stop without
 * its own label under the mouse and the stop under a finger, which scrubs along the track and selects on lift
 * (`timeline-scrub.ts`); never a year of several dates, whose date menu names them. V13: selecting a year with several dates (a tap, a click,
 * the end of a drag or a scrub, Enter, the gamepad's A) asks for its date menu (`hcm-dates-open`); its badge is a hint only.
 * A mouse resting on such a year, or a scrubbing finger resting on it, shows the menu without selecting the year
 * (`hcm-dates-peek`, `timeline-peek.ts`).
 */
import { DEFAULT_LOCALE, translate, type ViewerLocale } from '@hcm/shared';
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

import { cssProperties } from '../components/css-properties.js';
import { countOf, dateBadge, datesOpenEvent, datesValueText } from './timeline-dates.js';
import { edgeButtons, type Edges } from './timeline-edges.js';
import { stopIndex, YEAR_GAP_PX, timelineDensity, type TimelineDensity, type TimelineStop } from './timeline-model.js';
import { wheelAlong } from './timeline-pan.js';
import { TimelinePointer } from './timeline-pointer.js';
import { TimelineScroll } from './timeline-scroll.js';
import { DatesPeek, datesPeekEvent, peekDates, peekPlace } from './timeline-peek.js';
import { YearSends } from './timeline-sends.js';
import { timelineStyles } from './timeline-styles.js';
import { maybeOpacityCard, OpacityReveal, placeOpacityCard, type YearOpacity } from './timeline-opacity.js';
import { placeTip, tipText, tipWanted, type TimelineTip } from './timeline-tip.js';

export const HCM_TIMELINE_TAG = 'hcm-timeline';

export type TimelineOrientation = 'horizontal' | 'vertical';

export { trackRatio } from './timeline-pointer.js';

/**
 * How many stops each key moves the thumb towards "today" (up, and right, or left right to left: Left and Right turn
 * with the direction); Home and End go to either end (the selection clamps).
 */
const KEY_STEPS: Readonly<Record<string, number>> = {
    ArrowRight: 1,
    ArrowUp: 1,
    PageUp: 1,
    ArrowLeft: -1,
    ArrowDown: -1,
    PageDown: -1,
    Home: -Infinity,
    End: Infinity,
};

/** The card's padding around the track: 44 px on either side lying, 24 px above and below standing (`timeline-styles.ts`). */
const LYING_PADDING_PX = 88;
const STANDING_PADDING_PX = 48;
/** Standing, a label in the pill's lane needs this far from the selected stop: half the 40 px pill and half a 20 px label. */
const PILL_REACH_PX = 30;
/** How wide the fade of an edge with more years beyond is: under its 48 px button. */
const FADE_PX = '56px';

/** A change that may move the selected year away from the card's centre (opening from the pill too: lesson 722). */
function moves(changed: PropertyValues): boolean {
    return changed.has('value') || changed.has('density') || changed.has('dragging') || changed.has('collapsed');
}

function percentText(percent: number): string {
    return `${String(percent)}%`;
}

export class HcmTimeline extends LitElement {
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

    /** When the opacity card shows: a mouse on the thumb, the focus on it, a finger's tap (`timeline-opacity.ts`). */
    readonly #reveal = new OpacityReveal(this);

    /** Sends `hcm-year-change`: at once for a key, at most once per frame during a press (`timeline-sends.ts`). */
    readonly #sends = new YearSends((year) => {
        this.dispatchEvent(new CustomEvent('hcm-year-change', { bubbles: true, detail: { year } }));
    });

    /** The track's pointers: a mouse's drag and hover, a finger's scrub and tap (`timeline-pointer.ts`). */
    readonly #pointer = new TimelinePointer({
        vertical: () => this.orientation === 'vertical',
        rtl: () => this.#rtl(),
        scrolls: () => this.density === 'scroll',
        scroller: () => this.#scroller(),
        count: () => this.stops.length,
        // A sweep that moved the year chose a year: an opacity card a hold opened under it closes (lesson 806).
        select: (index, moving = false) => {
            const before = this.value;
            this.#select(index, true);
            this.#pointerStop = this.value;
            this.#reveal.sweep(moving && this.value !== before);
        },
        settle: (released) => {
            this.#settle(released);
        },
        focus: () => {
            this.focus();
        },
        dragging: (dragging) => {
            this.dragging = dragging;
            if (dragging) {
                this.#peek.stop(true);
            }
        },
        touchTip: (index) => {
            this.tip = index === null || this.#severalDates(index) ? null : { index, touch: true };
            if (index !== null) {
                this.#peek.rest(index, 'touch');
            }
        },
        hint: (index) => {
            this.#hintAt(index);
            if (!this.dragging) {
                this.#peek.rest(index, 'mouse');
            }
        },
        hideHint: () => {
            this.#hideHint();
            this.#peek.away();
        },
        peek: (event, lifted) => peekPlace(this, this.#peek.shown(), event, lifted),
    });
    /** V13's peek: the dates of the year a pointer rests on, the year not selected (`timeline-peek.ts`). */
    readonly #peek = new DatesPeek({
        datesAt: (index) => (this.#severalDates(index) ? peekDates(this, this.stops[index] ?? null, index) : null),
        send: (detail) => {
            this.dispatchEvent(datesPeekEvent(detail));
        },
    });
    /** Centring, the edges' fade and buttons, the labels left out (`timeline-scroll.ts`). */
    readonly #scroll = new TimelineScroll(this);
    /** A new size (the window turned, the card opened) centres the selected year again. */
    readonly #resize = new ResizeObserver(() => {
        this.#measure();
        this.#scroll.want();
    });

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

    override connectedCallback(): void {
        super.connectedCallback();
        this.#resize.observe(this);
        this.#reveal.listen(this.renderRoot);
    }

    override disconnectedCallback(): void {
        this.#resize.disconnect();
        this.#sends.drop();
        this.#pointer.end();
        this.#peek.stop(false);
        this.#reveal.disconnect();
        super.disconnectedCallback();
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('stops') || changed.has('orientation')) {
            this.#measure();
        }
    }

    /** A year a pointer chose stays where it is, never centred (centring it panned the bar under the pill, lesson 716). */
    #pointerStop: TimelineStop | undefined = undefined;

    protected override updated(changed: PropertyValues<this>): void {
        this.#scroll.afterUpdate(moves(changed) && !this.dragging && this.value !== this.#pointerStop, changed.get('value') !== undefined);
        this.#scroll.fadeEdges();
        this.#scroll.crowd();
        this.#placeTip();
        placeOpacityCard(this, this.#rtl(), this.orientation === 'vertical');
        this.#markTipping();
    }

    /**
     * `tipping` while the chip shows (none on the collapsed pill), `tipping="focus"` when it is the keyboard's: the
     * photos chip under it then stays in the Tab order (`dock-styles.ts`, lesson 648).
     */
    #markTipping(): void {
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
    #placeTip(): void {
        const tip = this.renderRoot.querySelector<HTMLElement>('.tip');
        const stop = this.renderRoot.querySelectorAll('.stop')[this.tip?.index ?? -1];
        if (tip === null || stop === undefined) {
            return;
        }
        const card = this.getBoundingClientRect();
        const mark = stop.getBoundingClientRect();
        const anchor = { x: mark.left + mark.width / 2 - card.left, y: mark.top + mark.height / 2 - card.top };
        const viewport = { width: innerWidth, height: innerHeight, rtl: this.#rtl(), vertical: this.orientation === 'vertical' };
        const place = placeTip(anchor, { width: tip.offsetWidth, height: tip.offsetHeight }, card, viewport);
        tip.style.left = `${String(place.left)}px`;
        tip.style.top = `${String(place.top)}px`;
    }

    /** The density for the card's size now: whether the years, 40 px apart, fit the room along its track. */
    #measure(): void {
        const vertical = this.orientation === 'vertical';
        const room = vertical ? this.clientHeight - STANDING_PADDING_PX : this.clientWidth - LYING_PADDING_PX;
        this.density = timelineDensity(room, this.stops.length - 1);
    }

    #scroller(): HTMLElement | null {
        return this.#scroll.scroller();
    }

    readonly #onScroll = (): void => {
        this.#scroll.fadeEdges();
    };

    /** A wheel over a lying scrolling card scrolls the years sideways (`timeline-pan.ts`). */
    readonly #onWheel = (event: WheelEvent): void => {
        wheelAlong(event, this.density === 'scroll' && this.orientation !== 'vertical');
    };

    /** A long press on the phone's pill (`timeline-dock.ts`): the opacity card shows once the card is open. */
    holdOpacity = (): void => {
        this.#reveal.hold();
    };

    /** Moves keyboard focus to the thumb (the viewer's "skip to timeline" link). */
    override focus(options?: FocusOptions): void {
        this.renderRoot.querySelector<HTMLElement>('[role="slider"]')?.focus(options);
    }

    override render(): TemplateResult {
        const index = stopIndex(this.stops, this.value);
        const position = { '--hcm-position': percentText(this.#percent(index)) };
        const fade = { '--hcm-fade-start': this.fade.start ? FADE_PX : '0px', '--hcm-fade-end': this.fade.end ? FADE_PX : '0px' };
        const card = maybeOpacityCard(this, this.#reveal, this.collapsed || this.dragging);
        return html`<div class="scroller" ${cssProperties(fade)} @scroll=${this.#onScroll} @wheel=${this.#onWheel}>
                ${this.#track(index, position)}
            </div>
            ${card}${edgeButtons({
                edges: this.fade,
                stops: this.stops,
                vertical: this.orientation === 'vertical',
                locale: this.locale,
                collapsed: this.collapsed,
                onPage: this.#scroll.page,
            })}
            ${this.#chip()}<span class="visually-hidden" aria-live="polite">${this.said}</span>`;
    }

    /** The year chip, unless the opacity card (`timeline-opacity.ts`) holds the place above the thumb. */
    #chip(): TemplateResult | typeof nothing {
        return this.#reveal.shown || this.tip === null || this.collapsed ? nothing : this.#tipChip(this.tip);
    }

    /** The chip: decorative, the slider's `aria-valuetext` already names the year. */
    #tipChip(tip: TimelineTip): TemplateResult {
        const stop = this.stops[tip.index] ?? null;
        return html`<div class="tip" aria-hidden="true">${tipText(stop, this.locale)}</div>`;
    }

    /** A mouse or a key on stop `index`: the chip when it has no label of its own or several dates; never over a finger's. */
    #hintAt(index: number): void {
        if (this.tip?.touch === true) {
            return;
        }
        const wanted = tipWanted(this.#named(index), this.#severalDates(index));
        this.tip = wanted ? { index, touch: false } : null;
    }

    /** Whether stop `index` is a year of several dates: no chip there, its date menu names them (the owner, 2026-11-13). */
    #severalDates(index: number): boolean {
        return countOf(this.dateCounts, this.stops[index] ?? null) > 1;
    }

    /** Whether a stop's year is on the track: its label, or the pill for the selected one whatever the density. */
    #named(index: number): boolean {
        const selected = stopIndex(this.stops, this.value);
        return index === selected || (this.#labelled(index, selected) && !this.crowded.has(index));
    }

    #hideHint(): void {
        if (this.tip?.touch !== true) {
            this.tip = null;
        }
    }

    /** A keyboard's focus centres the selected year (a mouse's, after a pan, leaves the years where the visitor put them). */
    readonly #onFocus = (): void => {
        if (this.renderRoot.querySelector('.thumb:focus-visible') !== null) {
            if (!this.#scroll.handing) {
                this.#scroll.want();
            }
            this.#hintAt(stopIndex(this.stops, this.value));
        }
    };

    readonly #onBlur = (): void => {
        this.#hideHint();
    };

    #track(index: number, position: Readonly<Record<string, string>>): TemplateResult {
        return html`<div
            class="track"
            ${cssProperties({ '--hcm-gaps': String(this.stops.length - 1), '--hcm-year-gap': `${String(YEAR_GAP_PX)}px` })}
            @pointerdown=${this.#pointer.onDown}
            @pointermove=${this.#pointer.onHover}
            @pointerleave=${this.#pointer.onLeave}
        >
            <div class="rail"></div>
            <div class="active" ${cssProperties(position)}></div>
            <ol class="stops" aria-hidden="true">
                ${this.stops.map((stop, stopAt) => this.#stop(stop, stopAt, index))}
            </ol>
            <div
                class="thumb touch-target"
                role="slider"
                tabindex="0"
                aria-label=${translate(this.locale, 'timeline.label')}
                aria-orientation=${this.orientation}
                aria-valuemin="0"
                aria-valuemax=${String(this.stops.length - 1)}
                aria-valuenow=${String(index)}
                aria-valuetext=${this.#valueText(this.stops[index] ?? null)}
                ${cssProperties(position)}
                @keydown=${this.#onKeyDown}
                @click=${this.#onActivate}
                @focus=${this.#onFocus}
                @blur=${this.#onBlur}
            >
                <span class="thumb-label" aria-hidden="true">${this.#shortLabel(this.stops[index] ?? null)}</span>
                ${this.#badge(this.stops[index] ?? null)}
            </div>
        </div>`;
    }

    #stop(stop: TimelineStop, stopAt: number, selected: number): TemplateResult {
        const classes = { stop: true, selected: stopAt === selected, minor: !this.#labelled(stopAt, selected) || this.crowded.has(stopAt) };
        return html`<li class=${classMap(classes)} ${cssProperties({ '--hcm-stop': percentText(this.#percent(stopAt)) })}>
            <span class="label">${this.#shortLabel(stop)}</span>
            ${stopAt === selected ? '' : this.#badge(stop)}
        </li>`;
    }

    /** V13: the badge of a year with several dates, a hint for the eye only (the year's point and the slider are the targets). */
    #badge(stop: TimelineStop): TemplateResult {
        return dateBadge(stop, countOf(this.dateCounts, stop));
    }

    /**
     * V13 (the owner, 2026-11-13: "the date picker should show up when the user selects a year with multiple dates"): the
     * selected year, once rendered, asks for its date menu beside the thumb when it has several dates; nothing otherwise.
     */
    #offerDates(): void {
        const stop = this.value;
        if (stop === null || countOf(this.dateCounts, stop) < 2) {
            return;
        }
        void this.updateComplete.then(() => {
            const thumb = this.renderRoot.querySelector('.thumb');
            if (thumb !== null && this.value === stop) {
                this.#reveal.hide();
                this.dispatchEvent(datesOpenEvent(stop, thumb));
            }
        });
    }

    /** A click with no pointer behind it (`detail` 0: the gamepad's A, the D-pad's select) selects the year as Enter does. */
    readonly #onActivate = (event: MouseEvent): void => {
        if (event.detail === 0) {
            this.#offerDates();
        }
    };

    /** Whether a stop shows its year: every one lying; standing, not under the pill (the pill names the selected year). */
    #labelled(stopAt: number, selected: number): boolean {
        return this.orientation !== 'vertical' || stopAt === selected || Math.abs(stopAt - selected) * YEAR_GAP_PX >= PILL_REACH_PX;
    }

    #percent(index: number): number {
        const last = this.stops.length - 1;
        return last > 0 ? (index / last) * 100 : 0;
    }

    #shortLabel(stop: TimelineStop): string {
        return stop === null ? translate(this.locale, 'timeline.present') : String(stop);
    }

    #valueText(stop: TimelineStop): string {
        if (stop === null) {
            return translate(this.locale, 'timeline.present');
        }
        return datesValueText(this.locale, translate(this.locale, 'timeline.year', { year: String(stop) }), countOf(this.dateCounts, stop));
    }

    readonly #onKeyDown = (event: KeyboardEvent): void => {
        this.#reveal.onKeyDown(event);
        if (event.key === 'Enter') {
            this.#datesByKey(event);
            return;
        }
        // The arrows move the year live, as a drag does; the menu waits for Enter (WCAG 3.2.2: no change of context on input).
        const step = KEY_STEPS[event.key];
        if (step === undefined) {
            return;
        }
        event.preventDefault();
        this.#pointerStop = undefined;
        const turned = /^Arrow[LR]/.test(event.key) && this.#rtl();
        this.#select(stopIndex(this.stops, this.value) + (turned ? -step : step));
        this.#hintAt(stopIndex(this.stops, this.value));
    };

    /** V13: Enter (the keyboard's and the remote's select) on a year with several dates opens its date menu, every time. */
    #datesByKey(event: KeyboardEvent): void {
        if (this.value !== null && countOf(this.dateCounts, this.value) > 1) {
            event.preventDefault();
            this.#offerDates();
        }
    }

    #rtl(): boolean {
        return this.matches(':dir(rtl)');
    }

    /** Selects a stop; a press's (`live`) years are sent at most once per frame (the owner, 2026-11-13). */
    #select(index: number, live = false): void {
        const clamped = Math.min(this.stops.length - 1, Math.max(0, index));
        const stop = this.stops[clamped] ?? null;
        if (stop !== this.value) {
            this.value = stop;
            this.#sends.changed(stop, live);
        }
    }

    /**
     * A press ended: its last year is sent now and, if it changed the year, said politely. A press the visitor lifted (a
     * tap, a click, the end of a drag or a scrub) on a year with several dates opens its date menu, once per press: the
     * years a drag passes never do.
     */
    #settle(released: boolean): void {
        this.#peek.stop(!released);
        if (this.#sends.settle()) {
            this.said = this.#valueText(this.value);
        }
        if (released) {
            this.#offerDates();
        }
    }
}

/** Registers `<hcm-timeline>` once; calling it again is a no-op. */
export function defineHcmTimeline(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_TIMELINE_TAG) === undefined) {
        registry.define(HCM_TIMELINE_TAG, HcmTimeline);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-timeline': HcmTimeline;
    }
}
