/**
 * Where a scrolling `<hcm-timeline>` stands (the owner, 2026-11-14): the selected year centred on load, when the card
 * opens from its pill, gets a new size or the year changes from outside, never after a pointer chose it (lesson 716); the
 * edges with years beyond (their fade and buttons, `timeline-edges.ts`); which lying labels are left out so none touches
 * another; a page towards an edge. A centring asked for while the card has no size waits until it has one (lesson
 * 722: the bar opened on today, the year set while the card was a pill or not laid out yet).
 */
import { clearOfPill, crowdedLabels, edgesBeyond, pageTowards, sameSet, type Edge, type Edges } from './timeline-edges.js';
import { YEAR_GAP_PX, type TimelineDensity } from './timeline-model.js';

/** What the controller reads and writes on the timeline. */
export interface ScrollView {
    readonly renderRoot: HTMLElement | DocumentFragment;
    readonly shadowRoot: ShadowRoot | null;
    readonly orientation: string;
    readonly collapsed: boolean;
    readonly dragging: boolean;
    readonly density: TimelineDensity;
    fade: Edges;
    crowded: ReadonlySet<number>;
    focus(options?: FocusOptions): void;
    matches(selectors: string): boolean;
    getBoundingClientRect(): DOMRect;
}

/** How long after a year is chosen the bar keeps it in view: the date menu and the opacity card open in that time. */
const KEEP_MS = 1500;

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
        this.keepInView(false);
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

    /**
     * The selected stop, out of the card's view, is centred again (the owner, 2026-11-22: after a drag and a click on 1943
     * the bar stood at its far end with no pill in view). A stop in view stays where the visitor put it.
     */
    keepInView(chosen: boolean): void {
        const scroller = this.#recent(chosen) ? this.#scrolling() : null;
        const stop = this.#view.renderRoot.querySelector('.stop.selected');
        if (scroller !== null && stop !== null && !within(stop.getBoundingClientRect(), scroller.getBoundingClientRect())) {
            this.#centre(scroller, stop);
        }
    }

    #chosenAt = Number.NEGATIVE_INFINITY;

    /**
     * A year was chosen now (`chosen`) or a moment ago, and the visitor has not panned the years since: a pan is theirs to
     * keep (an update during a mouse pan, a button stepping aside from the pill, centred the year back, lesson 796).
     */
    #recent(chosen: boolean): boolean {
        if (chosen) {
            this.#chosenAt = performance.now();
        }
        if (this.scroller()?.hasAttribute('data-panning') === true) {
            this.#chosenAt = Number.NEGATIVE_INFINITY;
        }
        return performance.now() - this.#chosenAt <= KEEP_MS;
    }

    /** After the timeline's update: centre the year when it `moved` (`want`), and keep a just-chosen one in view. */
    afterUpdate(moved: boolean, chosen: boolean): void {
        if (moved) {
            this.want();
        }
        this.keepInView(chosen);
    }

    /** The scroller of a scrolling, open, laid-out card that is not being dragged; else null. */
    #scrolling(): HTMLElement | null {
        const scroller = this.#still() ? this.scroller() : null;
        return scroller !== null && scroller.clientWidth > 0 ? scroller : null;
    }

    /** An open card that scrolls and is not being dragged. */
    #still(): boolean {
        return !this.#view.collapsed && !this.#view.dragging && this.#view.density === 'scroll';
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
        this.#watchPill(scroller);
        const fade = this.#edgesShown(scroller);
        if (fade.start !== this.#view.fade.start || fade.end !== this.#view.fade.end) {
            this.#keepFocus(fade);
            this.#view.fade = fade;
        }
    }

    /** The edges with years beyond whose buttons the selected pill leaves room for (`clearOfPill`). */
    #edgesShown(scroller: HTMLElement): Edges {
        const pill = this.#view.renderRoot.querySelector('.thumb')?.getBoundingClientRect();
        const way = { vertical: this.#vertical(), rtl: this.#view.matches(':dir(rtl)') };
        return clearOfPill(edgesBeyond(scroller, way.vertical), pill ?? null, this.#view.getBoundingClientRect(), way);
    }

    #watched: HTMLElement | null = null;

    /** The pill glides to a new year (350 ms): the edges are read again once it is there. */
    #watchPill(scroller: HTMLElement): void {
        if (this.#watched !== scroller) {
            this.#watched = scroller;
            scroller.addEventListener('transitionend', () => {
                this.fadeEdges();
            });
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

/** `box` lies inside `view` (a pixel of rounding either way). */
function within(box: DOMRect, view: DOMRect): boolean {
    const across = box.left >= view.left - 1 && box.right <= view.right + 1;
    return across && box.top >= view.top - 1 && box.bottom <= view.bottom + 1;
}
