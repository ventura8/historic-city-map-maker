import { translate } from '@hcm/shared';
import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

import { cssProperties } from '../components/css-properties.js';
import { countOf, dateBadge, datesOpenEvent } from './timeline-dates.js';
import { edgeButtons } from './timeline-edges.js';
import { stopIndex, YEAR_GAP_PX, timelineDensity, type TimelineStop } from './timeline-model.js';
import { wheelAlong } from './timeline-pan.js';
import { TimelinePointer } from './timeline-pointer.js';
import { TimelineScroll } from './timeline-scroll.js';
import { DatesPeek, datesPeekEvent, peekDates, peekPlace } from './timeline-peek.js';
import { YearSends } from './timeline-sends.js';
import { DATE_KEYS, KEY_STEPS } from './pill-keys.js';
import { PillGamepad } from './pill-gamepad.js';
import { TimelineProperties } from './timeline-properties.js';
import { maybeOpacityCard, OpacityReveal, placeOpacityCard } from './timeline-opacity.js';
import { tipText, tipWanted, type TimelineTip } from './timeline-tip.js';

export const HCM_TIMELINE_TAG = 'hcm-timeline';

export type TimelineOrientation = 'horizontal' | 'vertical';

export { trackRatio } from './timeline-pointer.js';

/** The card's padding around the track: 44 px on either side lying, 24 px above and below standing (`timeline-styles.ts`). */
const LYING_PADDING_PX = 88;
const STANDING_PADDING_PX = 48;
/** How wide the fade of an edge with more years beyond is: under its 48 px button. */
const FADE_PX = '56px';

/** A change that may move the selected year away from the card's centre (opening from the pill too: lesson 722). */
function moves(changed: PropertyValues): boolean {
    return changed.has('value') || changed.has('density') || changed.has('dragging') || changed.has('collapsed');
}

export class HcmTimeline extends TimelineProperties {
    readonly #pad = new PillGamepad((key) => {
        this.renderRoot.querySelector('.thumb')?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });

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
        scroller: () => this.#scroll.scroller(),
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

    override connectedCallback(): void {
        super.connectedCallback();
        this.#resize.observe(this);
        this.#reveal.listen(this.renderRoot);
    }

    override disconnectedCallback(): void {
        this.#pad.stop();
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
        this.placeTip();
        placeOpacityCard(this, this.#rtl(), this.orientation === 'vertical');
        this.markTipping();
    }

    /** The density for the card's size now: whether the years, 40 px apart, fit the room along its track. */
    #measure(): void {
        const vertical = this.orientation === 'vertical';
        const room = vertical ? this.clientHeight - STANDING_PADDING_PX : this.clientWidth - LYING_PADDING_PX;
        this.density = timelineDensity(room, this.stops.length - 1);
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
        const position = { '--hcm-position': `${String(this.percent(index))}%` };
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
        return index === selected || (this.labelled(index, selected) && !this.crowded.has(index));
    }

    #hideHint(): void {
        if (this.tip?.touch !== true) {
            this.tip = null;
        }
    }

    /** A keyboard's focus centres the selected year (a mouse's, after a pan, leaves the years where the visitor put them). */
    readonly #onFocus = (): void => {
        this.#pad.start();
        if (this.renderRoot.querySelector('.thumb:focus-visible') !== null) {
            if (!this.#scroll.handing) {
                this.#scroll.want();
            }
            this.#hintAt(stopIndex(this.stops, this.value));
        }
    };

    readonly #onBlur = (): void => {
        this.#pad.stop();
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
                data-year-pill
                tabindex="0"
                aria-label=${translate(this.locale, 'timeline.label')}
                aria-orientation=${this.orientation}
                aria-haspopup=${this.#severalDates(index) ? 'menu' : nothing}
                aria-valuemin="0"
                aria-valuemax=${String(this.stops.length - 1)}
                aria-valuenow=${String(index)}
                aria-valuetext=${this.valueText(this.stops[index] ?? null)}
                ${cssProperties(position)}
                @keydown=${this.#onKeyDown}
                @click=${this.#onActivate}
                @focus=${this.#onFocus}
                @blur=${this.#onBlur}
            >
                <span class="thumb-label" aria-hidden="true">${this.shortLabel(this.stops[index] ?? null)}</span>
                ${this.#badge(this.stops[index] ?? null)}
            </div>
        </div>`;
    }

    #stop(stop: TimelineStop, stopAt: number, selected: number): TemplateResult {
        const classes = { stop: true, selected: stopAt === selected, minor: !this.labelled(stopAt, selected) || this.crowded.has(stopAt) };
        const position = { '--hcm-stop': `${String(this.percent(stopAt))}%` };
        return html`<li class=${classMap(classes)} ${cssProperties(position)}>
            <span class="label">${this.shortLabel(stop)}</span>
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
    #offerDates(step?: number): void {
        const stop = this.value;
        if (stop === null || countOf(this.dateCounts, stop) < 2) {
            return;
        }
        void this.updateComplete.then(() => {
            const thumb = this.renderRoot.querySelector('.thumb');
            if (thumb !== null && this.value === stop) {
                this.#reveal.hide();
                this.dispatchEvent(datesOpenEvent(stop, thumb, step));
            }
        });
    }

    /** A click with no pointer behind it (`detail` 0: the gamepad's A, the D-pad's select) selects the year as Enter does. */
    readonly #onActivate = (event: MouseEvent): void => {
        if (event.detail === 0) {
            this.#offerDates(0);
        }
    };

    readonly #onKeyDown = (event: KeyboardEvent): void => {
        this.#reveal.onKeyDown(event);
        const dateStep = DATE_KEYS.get(event.key);
        if (dateStep !== undefined) {
            this.#datesByKey(event, dateStep);
            return;
        }
        const step = KEY_STEPS[event.key];
        if (step === undefined) {
            return;
        }
        event.preventDefault();
        this.#pointerStop = undefined;
        const turned = /^Arrow[LR]/.test(event.key) && this.#rtl();
        this.#select(stopIndex(this.stops, this.value) + (turned ? -step : step));
        this.#hintAt(stopIndex(this.stops, this.value));
        this.said = this.valueText(this.value);
    };

    /** V13: Enter (the keyboard's and the remote's select) on a year with several dates opens its date menu, every time. */
    #datesByKey(event: KeyboardEvent, step: number): void {
        if (step !== 0) {
            event.preventDefault();
        }
        if (countOf(this.dateCounts, this.value) > 1) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat || step !== 0) {
                this.#offerDates(step);
            }
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
            this.said = this.valueText(this.value);
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
