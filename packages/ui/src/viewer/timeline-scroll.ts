/**
 * Where a scrolling `<hcm-timeline>` stands (the owner, 2026-11-14): the selected year centred on load, when the card
 * opens from its pill, gets a new size or the year changes from outside, never after a pointer chose it (lesson 716); the
 * edges with years beyond (their fade and buttons, `timeline-edges.ts`); which lying labels are left out so none touches
 * another; a page towards an edge. A centring asked for while the card has no size waits until it has one (lesson
 * 722: the bar opened on today, the year set while the card was a pill or not laid out yet).
 */
import { crowdedLabels, edgesBeyond, pageTowards, sameSet, type Edge, type Edges } from './timeline-edges.js';
import { YEAR_GAP_PX, type TimelineDensity } from './timeline-model.js';

/** What the controller reads and writes on the timeline. */
export interface ScrollView {
    readonly renderRoot: HTMLElement | DocumentFragment;
    readonly shadowRoot: ShadowRoot | null;
    readonly orientation: string;
    readonly collapsed: boolean;
    readonly density: TimelineDensity;
    fade: Edges;
    crowded: ReadonlySet<number>;
    focus(options?: FocusOptions): void;
    matches(selectors: string): boolean;
}

export class TimelineScroll {
    readonly #view: ScrollView;
    /** The selected stop still waits to be centred. */
    #pending = true;
    /** True while a leaving edge button hands its focus to the thumb. */
    #handing = false;

    constructor(view: ScrollView) {
        this.#view = view;
    }

    scroller(): HTMLElement | null {
        return this.#view.renderRoot.querySelector<HTMLElement>('.scroller');
    }

    /** Whether the focus now arriving was handed over by a leaving edge button (it centres nothing). */
    get handing(): boolean {
        return this.#handing;
    }

    /** Asks for the selected stop to be centred, now or once the card has a size. */
    want(): void {
        this.#pending = true;
        this.reveal();
    }

    /** Centres the selected stop in a scrolling card once it has a size (the scroller only: the page never moves). */
    reveal(): void {
        const scroller = this.scroller();
        const stop = this.#view.renderRoot.querySelector('.stop.selected');
        if (scroller === null || stop === null || !this.#ready(scroller)) {
            return;
        }
        this.#pending = false;
        if (this.#view.density === 'scroll') {
            this.#centre(scroller, stop);
        }
    }

    #centre(scroller: HTMLElement, stop: Element): void {
        const view = scroller.getBoundingClientRect();
        const box = stop.getBoundingClientRect();
        if (this.#vertical()) {
            scroller.scrollBy({ top: box.top + box.height / 2 - (view.top + view.height / 2) });
        } else {
            scroller.scrollBy({ left: box.left + box.width / 2 - (view.left + view.width / 2) });
        }
    }

    #ready(scroller: HTMLElement): boolean {
        return this.#pending && !this.#view.collapsed && scroller.clientWidth > 0;
    }

    /** Which edges have more years beyond them; a focused edge button that goes hands its focus to the thumb. */
    fadeEdges(): void {
        const scroller = this.scroller();
        if (scroller === null) {
            return;
        }
        const fade = edgesBeyond(scroller, this.#vertical());
        if (fade.start !== this.#view.fade.start || fade.end !== this.#view.fade.end) {
            this.#keepFocus(fade);
            this.#view.fade = fade;
        }
    }

    #keepFocus(fade: Edges): void {
        const focused = this.#view.shadowRoot?.activeElement;
        const leaving = (['start', 'end'] as const).some((edge) => !fade[edge] && focused?.classList.contains(`edge-${edge}`) === true);
        if (leaving) {
            // Handed over, the thumb's focus must neither centre the year again nor scroll it into view: that undid the page.
            this.#handing = true;
            this.#view.focus({ preventScroll: true });
            this.#handing = false;
        }
    }

    /** Lying, which labels are left out so that none touches its neighbour's (a hidden label keeps its box, so widths hold). */
    crowd(): void {
        const labels = [...this.#view.renderRoot.querySelectorAll<HTMLElement>('.stop .label')];
        const crowded = this.#vertical()
            ? new Set<number>()
            : crowdedLabels(
                  labels.map((label) => label.offsetWidth),
                  YEAR_GAP_PX,
              );
        if (!sameSet(crowded, this.#view.crowded)) {
            this.#view.crowded = crowded;
        }
    }

    /** An edge button: one page towards its edge. */
    readonly page = (edge: Edge): void => {
        const scroller = this.scroller();
        if (scroller !== null) {
            const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
            pageTowards(scroller, edge, { vertical: this.#vertical(), rtl: this.#view.matches(':dir(rtl)'), reduced });
        }
    };

    #vertical(): boolean {
        return this.#view.orientation === 'vertical';
    }
}
