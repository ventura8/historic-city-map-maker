/**
 * The timeline's dock of `<hcm-map-viewer>` and what it opens: V12 and V13 (the owner, 2026-11-13).
 *
 * V12: on a phone (a standing timeline, or a short window's lying one) the timeline rests collapsed to the pill of its
 * year, a 48 px card in the corner the whole card took (`timeline-dock-styles.ts`), so it covers no more of the map than it
 * must. A press on it opens the whole card (the press is not a drag: the year stays); the skip link opens it too. It
 * collapses again when the visitor goes back to the map, a press anywhere in the viewer outside it, or presses Esc in it.
 * No timer collapses it (WCAG 2.2.1: a visitor reading or tabbing is never hurried; DECISIONS-for-review.md §195). The
 * collapsed card is still the slider: the arrow keys change the year and the screen reader hears it.
 *
 * V13: a year with several dates carries a badge (`timeline-dates.ts`), a hint only; selecting that year (a tap, a click,
 * the end of a drag or a scrub, Enter, the gamepad's A) opens `<hcm-date-menu>` beside the thumb, and the date picked comes
 * to the front (the store's `pickLayer`, V15's mechanism); Esc, a press outside it or the gamepad's B close it. A pointer
 * resting on such a year shows the menu as a peek (`hcm-dates-peek`, `timeline-peek.ts`): not modal, the year not selected;
 * a menu opened by selecting the year is never replaced by one. A mouse's peek closes `PEEK_LEAVE_MS` after the mouse left
 * both the year and the menu; Esc or a press elsewhere closes it at once.
 */
import { html, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from 'lit';

import type { HcmTimeline } from './hcm-timeline.js';
import { isPopup, type DockView, type TimelineHandlers } from './dock-date-menu.js';
import { countOf, dateCounts, datesOpenEvent, type DatesOpenDetail } from './timeline-dates.js';
import { announceDate } from './pill-date.js';
import { LongPress } from './long-press.js';
export { dateMenu, shownLayers, type DateMenuHandlers, type DockView } from './dock-date-menu.js';
import { type opacitySheet, sliderPanel } from './opacity-sheet.js';
import { PEEK_LEAVE_MS, type DatesPeekDetail } from './timeline-peek.js';

/** The floating controls the date menu keeps clear of (`date-menu-clear.ts`). */
const AVOIDED =
    '#timeline, [data-layout-check="compass"], [data-layout-check="locate"], [data-layout-check="zoom"], hcm-fab-menu, [data-layout-check="near-year"]';

/** What the dock needs from the viewer element. */
export type DockHost = ReactiveControllerHost & HTMLElement & { readonly renderRoot: HTMLElement | DocumentFragment };

/** The timeline's open state on a phone and the date picker's, kept by the viewer element across renders. */
export class TimelineDock implements ReactiveController {
    /** On a phone, the whole card shows (false: its pill). */
    expanded = false;
    /** The open date picker's year and anchor; null: closed. */
    dates: DatesOpenDetail | null = null;
    /** The menu open is a peek (a pointer resting on its year), not modal. */
    peek = false;
    /** The timeline is a phone's (it rests as its pill), as the last render asked (`collapsed`). */
    phone = false;
    /** The year's opacity sheet is open (a phone's, `opacity-sheet.ts`). */
    sheet = false;
    /** The last render's year opacity, language and opacity handler: what the sheet shows and sends to. */
    #opacity: Pick<DockView, 'opacity' | 'locale'> | null = null;
    #onOpacity: (event: CustomEvent) => void = () => undefined;

    readonly #host: DockHost;
    /** A finger held on the pill: the card opens with its opacity card (`long-press.ts`). */
    readonly #hold = new LongPress(() => {
        this.#timeline()?.holdOpacity();
    });
    /** The gentle close of a mouse's peek, waiting. */
    #closing: ReturnType<typeof setTimeout> | undefined;

    constructor(host: DockHost) {
        this.#host = host;
        host.addController(this);
    }

    hostConnected(): void {
        this.#host.addEventListener('pointerdown', this.#outside, true);
        window.addEventListener('keydown', this.#escPeek);
    }

    hostDisconnected(): void {
        this.#host.removeEventListener('pointerdown', this.#outside, true);
        window.removeEventListener('keydown', this.#escPeek);
        this.#hold.cancel();
        clearTimeout(this.#closing);
    }

    /** Whether a modal menu is open (the frame under it inert); a peek is not. */
    modal(): boolean {
        return (this.dates !== null && this.dates.step === undefined && !this.peek) || this.sheet;
    }

    /** What the timeline of this render shows and sends (`timelineDock`): the opacity sheet uses the same. */
    remember(view: Pick<DockView, 'opacity' | 'locale'>, onOpacity: (event: CustomEvent) => void): void {
        this.#opacity = view;
        this.#onOpacity = onOpacity;
    }

    /** The timeline asks for the year's opacity sheet (a phone): it opens with the focus on its first slider. */
    readonly onOpacitySheet = (event: Event): void => {
        event.stopPropagation();
        if (!this.#opacity?.opacity) {
            return;
        }
        if (this.#datesInstead()) {
            return;
        }
        this.dates = null;
        this.sheet = true;
        this.#host.requestUpdate();
        void this.#host.updateComplete.then(() => {
            this.#host.renderRoot.querySelector<HTMLElement>('.opacity-sheet hcm-slider')?.focus();
        });
    };

    /**
     * A year of several dates shows its date menu with the sliders beside or under it, never the sheet alone (the owner,
     * 2026-11-22): Enter on a phone's pill sent both, and the sheet's late focus closed the menu, so a press showed the
     * sliders alone, the menu alone or nothing. True when the menu opens (or is open) in the sheet's place.
     */
    #datesInstead(): boolean {
        const timeline = this.#timeline();
        if (timeline === null || countOf(timeline.dateCounts, timeline.value) < 2) {
            return false;
        }
        if (this.dates === null) {
            this.#datesAtThumb(timeline);
        }
        return true;
    }

    /** Opens the date menu of the timeline's year beside its thumb. */
    #datesAtThumb(timeline: HcmTimeline): void {
        const thumb = timeline.renderRoot.querySelector('.thumb');
        if (thumb !== null && timeline.value !== null) {
            this.#openDates(datesOpenEvent(timeline.value, thumb).detail);
        }
    }

    /** Closes the opacity sheet; the focus goes back to the timeline once the frame is no longer inert. */
    readonly closeSheet = (): void => {
        this.sheet = false;
        this.#host.requestUpdate();
        void this.#host.updateComplete.then(() => {
            this.#timeline()?.focus();
        });
    };

    /** The sliders beside the date menu of `year`, when it is the selected year with layers (`hcm-date-menu.ts`). */
    sidePanel(year: number): TemplateResult | null {
        const view = this.#opacity;
        return view?.opacity?.year === year ? sliderPanel(view.opacity, view.locale, this.#onOpacity) : null;
    }

    /** The sheet while it is open and the year has layers: its model (`opacity-sheet.ts`). */
    sheetModel(): Parameters<typeof opacitySheet>[0] {
        const view = this.sheet ? this.#opacity : null;
        return view?.opacity ? { year: view.opacity, locale: view.locale, close: this.closeSheet, send: this.#onOpacity } : null;
    }

    /** A pointer rests on a year of several dates, or left it: its peek opens, or closes (gently: after `PEEK_LEAVE_MS`). */
    readonly onDatesPeek = (event: CustomEvent<DatesPeekDetail>): void => {
        event.stopPropagation();
        if (this.#pillPanelOpen() || this.modal()) {
            return;
        }
        clearTimeout(this.#closing);
        const { dates, gently } = event.detail;
        if (dates !== null) {
            this.dates = dates;
            this.peek = true;
            this.#host.requestUpdate();
        } else if (gently) {
            this.#closeLater();
        } else {
            this.closePeek();
        }
    };

    /** The mouse entered the peek (it stays) or left it (it closes after `PEEK_LEAVE_MS` unless the mouse comes back). */
    readonly onMenuPointer = (event: CustomEvent<{ readonly inside: boolean }>): void => {
        clearTimeout(this.#closing);
        if (this.peek && !event.detail.inside) {
            this.#closeLater();
        }
    };

    /** A picked date turns a peek into the persistent menu of the selected year. */
    readonly keepDates = (): void => {
        clearTimeout(this.#closing);
        this.peek = false;
        this.#host.requestUpdate();
    };

    /** Closes a peek, the focus left where it is. */
    readonly closePeek = (): void => {
        clearTimeout(this.#closing);
        if (this.peek) {
            this.peek = false;
            this.dates = null;
            this.#host.requestUpdate();
        }
    };

    #closeLater(): void {
        this.#closing = setTimeout(this.closePeek, PEEK_LEAVE_MS);
    }

    readonly #escPeek = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.peek) {
            this.closePeek();
        }
    };

    /** Whether the card shows as its pill now: a phone's timeline (`phone`) that is not open. */
    collapsed(phone: boolean): boolean {
        this.phone = phone;
        return phone && !this.expanded;
    }

    /** Opens the whole card (the skip link, a press on the pill). */
    expand(): void {
        this.#set(true);
    }

    /** A press on the pill opens the card instead of moving the year (or opening its dates): caught on its way down to the timeline. */
    readonly pointerDown = {
        capture: true,
        handleEvent: (event: PointerEvent): void => {
            if (this.#timeline()?.collapsed === true) {
                event.preventDefault();
                event.stopPropagation();
                this.#hold.start(event);
                this.#set(true);
            }
        },
    };

    /** Esc in the open card of a phone collapses it to its pill; the slider keeps the focus. */
    readonly onKeyDown = (event: KeyboardEvent): void => {
        if (this.#pillPanelOpen() && this.#panelKey(event)) {
            return;
        }
        if (event.key === 'Escape' && this.expanded) {
            this.#set(false);
        }
    };

    #pillPanelOpen(): boolean {
        return this.dates?.step !== undefined;
    }

    #focusFront(): void {
        this.#host.renderRoot.querySelector('hcm-date-menu')?.shadowRoot?.querySelector<HTMLElement>('[data-front]')?.focus();
    }

    #panelKey(event: KeyboardEvent): boolean {
        if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            this.#focusFront();
            return true;
        }
        if (event.key === 'Escape') {
            this.closeDates();
            return true;
        }
        return false;
    }

    /**
     * The timeline asks for a year's dates. On a phone's pill (Enter or the gamepad's A on it) the card opens first and the
     * menu opens beside its thumb there, so it never sits over the pill's corner.
     */
    readonly onDatesOpen = (event: CustomEvent<DatesOpenDetail>): void => {
        event.stopPropagation();
        if (this.#togglesClosed(event.detail)) {
            this.closeDates();
            return;
        }
        const timeline = this.#timeline();
        if (timeline?.collapsed !== true) {
            this.#openDates(event.detail);
            return;
        }
        this.#openDates(event.detail);
        this.#set(true);
        void this.#host.updateComplete
            .then(() => timeline.updateComplete)
            .then(() => {
                const thumb = timeline.renderRoot.querySelector('.thumb');
                if (thumb !== null && this.dates === event.detail) {
                    this.#openDates(datesOpenEvent(event.detail.year, thumb, event.detail.step).detail);
                }
            });
    };

    #togglesClosed(detail: DatesOpenDetail): boolean {
        return detail.step === 0 && this.dates?.year === detail.year;
    }

    #openDates(detail: DatesOpenDetail): void {
        clearTimeout(this.#closing);
        this.sheet = false;
        this.peek = false;
        this.dates = detail;
        this.#host.requestUpdate();
    }

    /** B (or the Xbox's emulated GamepadB: the input `close`) over the date menu closes it and keeps the date shown. */
    closedBy(command: string): boolean {
        if (command !== 'close' || (this.dates === null && !this.sheet)) {
            return false;
        }
        if (this.sheet) {
            this.closeSheet();
        } else {
            this.closeDates();
        }
        return true;
    }

    /** Closes the date picker; the focus goes back to the slider once the frame is no longer inert. */
    readonly closeDates = (): void => {
        clearTimeout(this.#closing);
        this.peek = false;
        this.dates = null;
        this.#host.requestUpdate();
        void this.#host.updateComplete.then(() => {
            this.#timeline()?.focus();
        });
    };

    /** A press in the viewer outside the dock and the date picker: the visitor went back to the map. */
    readonly #outside = (event: Event): void => {
        const path = event.composedPath();
        const dock = this.#host.renderRoot.querySelector('.dock.timeline');
        const onMenu = path.some((target) => target instanceof Element && target.localName === 'hcm-date-menu');
        if (!onMenu) {
            this.closePeek();
        }
        const inside = path.some((target) => target instanceof Element && (target === dock || isPopup(target)));
        if (inside) {
            return;
        }
        if (this.#pillPanelOpen()) {
            this.dates = null;
            this.#host.requestUpdate();
        }
        this.#set(false);
    };

    /** The boxes of what the date menu keeps clear of now: the card, the compass, the zoom, the menu button, the photos chip. */
    readonly controls = (): DOMRect[] => {
        const shown = [...this.#host.renderRoot.querySelectorAll(AVOIDED)].map((element) => element.getBoundingClientRect());
        return shown.filter((box) => box.width > 0 && box.height > 0);
    };

    #timeline(): HcmTimeline | null {
        return this.#host.renderRoot.querySelector<HcmTimeline>('#timeline');
    }

    #set(expanded: boolean): void {
        if (this.expanded !== expanded) {
            this.expanded = expanded;
            this.#host.requestUpdate();
        }
    }
}

/** The timeline in its dock: the whole card, or on an idle phone its pill (`collapsed`). */
export function timelineDock(view: DockView, dock: TimelineDock, handlers: TimelineHandlers): TemplateResult {
    dock.remember(view, handlers.onOverlayOpacity);
    return html`<div class="dock timeline" @pointerdown=${dock.pointerDown} @keydown=${dock.onKeyDown}>
        <hcm-timeline
            id="timeline"
            data-layout-check="timeline"
            .stops=${view.stops}
            .value=${view.year}
            .locale=${view.locale}
            .orientation=${view.orientation}
            .collapsed=${view.collapsed}
            .dateCounts=${dateCounts(view.layers)}
            .opacity=${view.opacity}
            ?phone=${dock.phone}
            ?dates-open=${dock.dates !== null}
            ?near-year=${(view.near ?? null) !== null && view.year !== null}
            @hcm-year-change=${(event: CustomEvent) => {
                if (dock.dates?.step !== undefined) {
                    dock.dates = null;
                }
                handlers.onYearChange(event);
            }}
            @hcm-overlay-opacity=${handlers.onOverlayOpacity}
            @hcm-dates-open=${(event: CustomEvent<DatesOpenDetail>) => {
                dock.onDatesOpen(event);
                announceDate(event, view, dock.dates, handlers.onDatePick);
            }}
            @hcm-dates-peek=${dock.onDatesPeek}
            @hcm-opacity-sheet=${dock.onOpacitySheet}
        ></hcm-timeline>
    </div>`;
}
