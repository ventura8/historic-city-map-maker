/**
 * The selected year's opacity slider (the owner, 2026-11-15: "when the pointer hovers on the selected year pill, show a
 * slider that changes the opacity of that year's layer"; scenario V12). A mouse resting on the timeline's thumb, Enter on
 * it, or a finger's tap on it (a press that did not scrub) shows a small card beside it holding the kit's slider per layer of
 * the year (several layers: an "all" slider first, `timeline-opacity-card.ts`), a finger held on the pill too
 * (`long-press.ts`). The keyboard's or the D-pad's focus alone does not: on a TV it stood in the D-pad's way. On a phone
 * (`phone`, set by the dock) the card is a modal sheet instead (`opacity-sheet.ts`, asked for with `hcm-opacity-sheet`):
 * a tap, a long press, Enter, or the Opacity button the open card carries. Each slider is named as the Layers panel names it
 * (`layers.opacity`).
 * It fires the Layers panel's own `hcm-overlay-opacity` (`{id, opacity, final}`), so the store keeps one value and the
 * panel's slider follows. The card hides when the pointer and the focus have both left the thumb and the card, on Esc (the
 * focus goes back to the thumb) and on a press anywhere else.
 */
import { overlayLabel, translate, type Layer, type Overlay, type ViewerLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { opacitySliders, type YearLayer, type YearOpacity } from './timeline-opacity-card.js';
import { dateItems } from './timeline-dates.js';
import { LongPress } from './long-press.js';
import { placeTip } from './timeline-tip.js';

export type { YearOpacity } from './timeline-opacity-card.js';

/** How far (px) a finger may move between down and up and still be a tap on the thumb, not a scrub. */
const TAP_SLOP_PX = 10;
/** How long (ms) the card waits after the pointer left before hiding: the way from the thumb up to the card. */
const HIDE_DELAY_MS = 400;

/** `target` as an Element, or null. */
function elementOf(target: EventTarget | null): Element | null {
    return target instanceof Element ? target : null;
}

/** The next ancestor in the flat tree: parent, or the host when `node` sits at a shadow root. */
function nextFlat(node: Element): Element | null {
    if (node.parentElement !== null) {
        return node.parentElement;
    }
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
}

/** The card's layers: every layer of `year` among the overlays, by date (`dateItems`), or null (none). */
export function yearOpacity(
    overlays: readonly Overlay[],
    layers: readonly Pick<Layer, 'id' | 'year' | 'date' | 'label'>[],
    year: number,
    locale: ViewerLocale,
): YearOpacity | null {
    const rows = dateItems(layers, year, locale).flatMap((item): YearLayer[] => {
        const overlay = overlays.find((candidate) => candidate.id === item.id);
        return overlay === undefined
            ? []
            : [{ id: overlay.id, name: overlayLabel(overlay, locale), date: item.date, opacity: overlay.opacity }];
    });
    return rows.length === 0 ? null : { year, layers: rows };
}

/** What the reveal needs from its timeline. */
export interface OpacityHost extends EventTarget {
    readonly renderRoot: HTMLElement | DocumentFragment;
    requestUpdate(): void;
}

/** When the card shows: hover, focus, a tap; and when it hides. */
export class OpacityReveal {
    shown = false;
    #down: { readonly x: number; readonly y: number } | null = null;
    #hiding: ReturnType<typeof setTimeout> | undefined;
    #root: EventTarget | null = null;
    /** A pointer pressed the thumb since it last lost the focus: the focus it has is a press's, not the keyboard's. */
    #pressing = false;
    /** Opened by a long press or the Opacity button: it lasts until Esc or a press elsewhere, the focus may leave it. */
    #held = false;
    /** A mouse rests on the thumb or the card: the focus leaving does not close it. */
    #pointerInside = false;

    /** A finger held on the thumb opens the card at once (`long-press.ts`). */
    readonly #hold = new LongPress(() => {
        this.hold();
    });

    constructor(private readonly host: OpacityHost) {}

    /** A long press (on the thumb, or on the phone's pill, `timeline-dock.ts`): the card shows, the finger's lift does not toggle it. */
    hold(): void {
        this.#down = null;
        this.open();
        this.#held = this.shown;
    }

    /** Opens the card, or on a phone asks the dock for its modal sheet. */
    open(): void {
        if (this.#phone()) {
            this.host.dispatchEvent(new CustomEvent('hcm-opacity-sheet', { bubbles: true, composed: true }));
            return;
        }
        this.show();
    }

    #phone(): boolean {
        return this.host instanceof Element && this.host.hasAttribute('phone');
    }

    /** Listens on the timeline's shadow root for the thumb's pointer and focus events (one place, not six bindings). */
    listen(root: EventTarget): void {
        if (this.#root === root) {
            return;
        }
        this.#root = root;
        const onThumb =
            (handler: (event: PointerEvent & FocusEvent) => void) =>
            (event: Event): void => {
                if (event.target instanceof Element && event.target.closest('.thumb') !== null) {
                    handler(event as PointerEvent & FocusEvent);
                }
            };
        root.addEventListener('pointerover', onThumb(this.onEnter));
        root.addEventListener('pointerout', onThumb(this.onLeave));
        root.addEventListener('pointerdown', onThumb(this.onThumbDown));
        // Any press on the track (a scrub from the pill, a tap on a year) focuses the thumb, in its own pointerdown: that
        // focus is not the keyboard's, so the mark is set first (capture), before the track's handler runs.
        root.addEventListener(
            'pointerdown',
            (event) => {
                this.#pressing = true;
                const onThumb = (event.target as Element).closest('.thumb') !== null;
                if (!this.#within(event.target) || (onThumb && (event as PointerEvent).pointerType === 'touch')) {
                    this.#set(false);
                }
            },
            true,
        );
        root.addEventListener('pointerup', onThumb(this.onThumbUp));
        root.addEventListener('focusin', onThumb(this.onFocusIn));
        root.addEventListener('focusout', onThumb(this.onFocusOut));
        root.addEventListener('keydown', onThumb(this.onThumbKey));
    }

    /** Enter on the pill opens the card (a year of several dates opens its date menu in its place, `hide`). */
    readonly onThumbKey = (event: Event): void => {
        if ((event as KeyboardEvent).key === 'Enter') {
            this.open();
        }
    };

    readonly onEnter = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch' && !this.#phone()) {
            this.#pointerInside = true;
            this.show();
        }
    };

    readonly onLeave = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') {
            this.#pointerInside = false;
            this.#hideLater();
        }
    };

    readonly onThumbDown = (event: PointerEvent): void => {
        this.#pressing = true;
        this.#hold.start(event);
        this.#down = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : null;
    };

    /** A finger lifted where it went down: a tap on the selected year opens or closes the card. */
    readonly onThumbUp = (event: PointerEvent): void => {
        const down = this.#down;
        this.#down = null;
        if (down !== null && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= TAP_SLOP_PX) {
            this.#tapped();
        }
    };

    /** A tap on the selected year: the phone's sheet, else the card opens or closes. */
    #tapped(): void {
        if (this.#phone()) {
            this.open();
        } else {
            this.#set(!this.shown);
        }
    }

    /** Any focus in the card keeps it; the focus on the thumb alone does not open it (the D-pad's path, the TV tour). */
    readonly onFocusIn = (event: FocusEvent): void => {
        const target = event.target;
        if (!this.#pressing && target instanceof Element && target.closest('.opacity') !== null) {
            this.show();
        }
    };

    readonly onFocusOut = (event: FocusEvent): void => {
        this.#pressing = false;
        if (this.#held || this.#pointerInside || this.#within(event.relatedTarget)) {
            return;
        }
        // relatedTarget is often null when focus crosses into a nested shadow; hide-later's :focus-within sees the handle.
        if (event.relatedTarget === null) {
            this.#hideLater();
            return;
        }
        this.#set(false);
    };

    readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.shown) {
            event.stopPropagation();
            // preventScroll: focus must not scroll the viewer (overflow:hidden still did; the host is overflow:clip).
            this.host.renderRoot.querySelector<HTMLElement>('.thumb')?.focus({ preventScroll: true });
            this.#set(false);
        }
    };

    /** A press outside the thumb and the card closes it. */
    readonly #outside = (event: Event): void => {
        if (!event.composedPath().some((target) => this.#within(target))) {
            this.#set(false);
        }
    };

    show(): void {
        clearTimeout(this.#hiding);
        this.#set(true);
    }

    /** Hides the card at once: the year's date menu opened in its place (one card at a time). */
    hide(): void {
        clearTimeout(this.#hiding);
        this.#set(false);
    }

    disconnect(): void {
        clearTimeout(this.#hiding);
        this.#hold.cancel();
        document.removeEventListener('pointerdown', this.#outside, true);
    }

    #hideLater(): void {
        clearTimeout(this.#hiding);
        this.#hiding = setTimeout(() => {
            // :focus-within sees the kit slider's handle inside its own shadow; :focus on a light descendant does not.
            if (this.host.renderRoot.querySelector('.opacity:focus-within') === null) {
                this.#set(false);
            }
        }, HIDE_DELAY_MS);
    }

    /** Whether `target` is the thumb, the card, or inside either (across the kit slider's shadow root). */
    #within(target: EventTarget | null): boolean {
        for (let node = elementOf(target); node !== null; node = nextFlat(node)) {
            if (this.#ownCardOrThumb(node)) {
                return true;
            }
        }
        return false;
    }

    /** The thumb or opacity card that belongs to this timeline (not another copy of the class names). */
    #ownCardOrThumb(node: Element): boolean {
        return node.matches('.thumb, .opacity') && this.host.renderRoot.contains(node);
    }

    #set(shown: boolean): void {
        this.#held &&= shown;
        if (this.shown === shown) {
            return;
        }
        this.shown = shown;
        if (shown) {
            document.addEventListener('pointerdown', this.#outside, true);
        } else {
            document.removeEventListener('pointerdown', this.#outside, true);
        }
        this.host.requestUpdate();
    }
}

/** The card: the year's sliders (`timeline-opacity-card.ts`), one or "all" and a row per layer. */
function opacityCard(
    year: YearOpacity,
    locale: ViewerLocale,
    reveal: OpacityReveal,
    { host, hidden }: { readonly host: EventTarget; readonly hidden: boolean },
): TemplateResult {
    return html`<div
        class="opacity ${year.layers.length > 1 ? 'several' : ''}"
        ?hidden=${hidden}
        @pointerenter=${reveal.onEnter}
        @pointerleave=${reveal.onLeave}
        @pointerdown=${(event: Event) => {
            event.stopPropagation();
        }}
        @focusin=${reveal.onFocusIn}
        @focusout=${reveal.onFocusOut}
        @keydown=${reveal.onKeyDown}
    >
        ${opacitySliders(year, locale, host)}
    </div>`;
}

/** The card, when there is a layer to change, the reveal is on and the card is not collapsed to its pill or dragged. */
export function maybeOpacityCard(
    host: EventTarget & { readonly opacity: YearOpacity | null; readonly locale: ViewerLocale },
    reveal: OpacityReveal,
    hidden: boolean,
): TemplateResult | typeof nothing {
    // Rendered while there is a layer, hidden between shows: the same element each time it shows (the tour's Tab round
    // comes back to the slider it left; a new element each time never came back).
    const layer = host.opacity;
    return layer === null ? nothing : withOpener(host, layer, reveal, hidden);
}

/** The card, after the Opacity button of a phone's open card (`phone`, not collapsed, not dragged). */
function withOpener(
    host: EventTarget & { readonly locale: ViewerLocale },
    year: YearOpacity,
    reveal: OpacityReveal,
    hidden: boolean,
): TemplateResult {
    const card = opacityCard(year, host.locale, reveal, { host, hidden: hidden || !reveal.shown });
    const phone = host instanceof Element && host.hasAttribute('phone');
    return html`${phone && !hidden ? opacityOpener(year, host.locale, reveal) : nothing}${card}`;
}

/** The Opacity button under the year of a phone's open card (the owner, 2026-11-16): the same sheet as a long press. */
function opacityOpener(year: YearOpacity, locale: ViewerLocale, reveal: OpacityReveal): TemplateResult {
    return html`<button
        type="button"
        class="opacity-open touch-target"
        aria-haspopup="dialog"
        @pointerdown=${(event: Event) => {
            event.stopPropagation();
        }}
        @click=${() => {
            reveal.open();
        }}
    >
        <hcm-icon name="opacity" aria-hidden="true"></hcm-icon
        ><span>${translate(locale, 'layers.opacity', { name: String(year.year) })}</span>
    </button>`;
}

/**
 * Puts the card centred straight above the thumb (beside a standing timeline), clamped inside the card's ends and the
 * viewport's edges (`placeTip`; the owner, 2026-11-16), its caret (`--hcm-caret`) over the thumb's centre wherever the
 * clamp moved the card. Tab from the thumb to the card's kit sliders crosses into their own shadow roots, so the step up
 * is not a step back up one component's column (the tour's focus order).
 */
export function placeOpacityCard(
    host: HTMLElement & OpacityHost & { readonly opacity: YearOpacity | null },
    rtl: boolean,
    vertical: boolean,
): void {
    // `fadable`: the pill has a card to open (its touch mark, `timeline-extra-styles.ts`).
    host.toggleAttribute('fadable', host.opacity !== null);
    const card = host.renderRoot.querySelector<HTMLElement>('.opacity');
    const thumb = host.renderRoot.querySelector('.thumb');
    if (card === null || thumb === null) {
        return;
    }
    const box = host.getBoundingClientRect();
    const mark = thumb.getBoundingClientRect();
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const centreX = mark.left + mark.width / 2 - box.left;
    const anchor = { x: centreX, y: mark.top + mark.height / 2 - box.top };
    const place = placeTip(anchor, size, box, { width: innerWidth, height: innerHeight, rtl, vertical });
    card.style.left = `${String(place.left)}px`;
    // The caret's place from the card's inline start (its right edge right to left).
    const caret = rtl ? place.left + size.width - centreX : centreX - place.left;
    card.style.setProperty('--hcm-caret', `${String(caret)}px`);
    card.style.top = `${String(place.top - (vertical ? 0 : mark.height / 2))}px`;
}
