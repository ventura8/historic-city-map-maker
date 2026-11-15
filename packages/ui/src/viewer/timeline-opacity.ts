/**
 * The selected year's opacity slider (the owner, 2026-11-15: "when the pointer hovers on the selected year pill, show a
 * slider that changes the opacity of that year's layer"; scenario V12). A mouse resting on the timeline's thumb, the
 * keyboard's focus on it, or a finger's tap on it (a press that did not scrub) shows a small card above it holding a native
 * range input: the year's front layer's opacity in steps of 5 %, named as the Layers panel names it (`layers.opacity`).
 * It fires the Layers panel's own `hcm-overlay-opacity` (`{id, opacity, final}`), so the store keeps one value and the
 * panel's slider follows. The card hides when the pointer and the focus have both left the thumb and the card, on Esc (the
 * focus goes back to the thumb) and on a press anywhere else.
 */
import { overlayLabel, translate, type Overlay, type ViewerLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { placeTip } from './timeline-tip.js';

/** The layer the slider changes: the selected year's front layer, as the store holds it. */
export interface YearOpacity {
    readonly id: string;
    readonly name: string;
    /** 0 to 1. */
    readonly opacity: number;
}

/** How far (px) a finger may move between down and up and still be a tap on the thumb, not a scrub. */
const TAP_SLOP_PX = 10;
/** How long (ms) the card waits after the pointer left before hiding: the way from the thumb up to the card. */
const HIDE_DELAY_MS = 400;

/** The slider's layer: the front layer of the selected year among the overlays, or null (today, or no such overlay). */
export function yearOpacity(overlays: readonly Overlay[], layerId: string | null, locale: ViewerLocale): YearOpacity | null {
    const overlay = overlays.find((candidate) => candidate.id === layerId);
    return overlay === undefined ? null : { id: overlay.id, name: overlayLabel(overlay, locale), opacity: overlay.opacity };
}

/** What the reveal needs from its timeline. */
export interface OpacityHost extends EventTarget {
    readonly renderRoot: HTMLElement | DocumentFragment;
    requestUpdate(): void;
}

/** When the card shows: hover, focus, a tap; and when it hides. */
export class OpacityReveal {
    shown = false;
    #pointerInside = false;
    #down: { readonly x: number; readonly y: number } | null = null;
    #hiding: ReturnType<typeof setTimeout> | undefined;
    #root: EventTarget | null = null;
    /** A pointer pressed the thumb since it last lost the focus: the focus it has is a press's, not the keyboard's. */
    #pressing = false;

    constructor(private readonly host: OpacityHost) {}

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
        root.addEventListener('pointerup', onThumb(this.onThumbUp));
        root.addEventListener('focusin', onThumb(this.onFocusIn));
        root.addEventListener('focusout', onThumb(this.onFocusOut));
    }

    readonly onEnter = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') {
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
        this.#down = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : null;
    };

    /** A finger lifted where it went down: a tap on the selected year opens or closes the card. */
    readonly onThumbUp = (event: PointerEvent): void => {
        const down = this.#down;
        this.#down = null;
        if (down !== null && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= TAP_SLOP_PX) {
            this.#set(!this.shown);
        }
    };

    /** The keyboard's focus on the thumb, or any focus in the card; a pointer's focus on the thumb is not a reason. */
    readonly onFocusIn = (event: FocusEvent): void => {
        const target = event.target;
        if (this.#pressing) {
            return;
        }
        if (target instanceof Element && (target.matches(':focus-visible') || target.closest('.opacity') !== null)) {
            this.show();
        }
    };

    readonly onFocusOut = (event: FocusEvent): void => {
        this.#pressing = false;
        if (!this.#within(event.relatedTarget) && !this.#pointerInside) {
            this.#set(false);
        }
    };

    readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && this.shown) {
            event.stopPropagation();
            this.host.renderRoot.querySelector<HTMLElement>('.thumb')?.focus();
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

    disconnect(): void {
        clearTimeout(this.#hiding);
        document.removeEventListener('pointerdown', this.#outside, true);
    }

    #hideLater(): void {
        clearTimeout(this.#hiding);
        this.#hiding = setTimeout(() => {
            if (this.host.renderRoot.querySelector('.opacity :focus') === null) {
                this.#set(false);
            }
        }, HIDE_DELAY_MS);
    }

    #within(target: EventTarget | null): boolean {
        return target instanceof Element && target.closest('.thumb, .opacity') !== null && this.host.renderRoot.contains(target);
    }

    #set(shown: boolean): void {
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

/** The card: one labelled range input, 0 to 100 % in steps of 5. */
export function opacityCard(layer: YearOpacity, locale: ViewerLocale, reveal: OpacityReveal, host: EventTarget): TemplateResult {
    const percent = Math.round(layer.opacity * 100);
    const send = (event: Event, final: boolean): void => {
        const value = Number((event.target as HTMLInputElement).value) / 100;
        host.dispatchEvent(new CustomEvent('hcm-overlay-opacity', { bubbles: true, detail: { id: layer.id, opacity: value, final } }));
    };
    return html`<div
        class="opacity"
        @pointerenter=${reveal.onEnter}
        @pointerleave=${reveal.onLeave}
        @pointerdown=${(event: Event) => {
            event.stopPropagation();
        }}
        @focusout=${reveal.onFocusOut}
        @keydown=${reveal.onKeyDown}
    >
        <input
            type="range"
            min="0"
            max="100"
            step="5"
            .value=${String(percent)}
            aria-label=${translate(locale, 'layers.opacity', { name: layer.name })}
            aria-valuetext=${translate(locale, 'layers.opacityValue', { percent: String(percent) })}
            @input=${(event: Event) => {
                send(event, false);
            }}
            @change=${(event: Event) => {
                send(event, true);
            }}
        />
    </div>`;
}

/** The card, when there is a layer to change, the reveal is on and the card is not collapsed to its pill or dragged. */
export function maybeOpacityCard(
    host: EventTarget & { readonly opacity: YearOpacity | null; readonly locale: ViewerLocale },
    reveal: OpacityReveal,
    hidden: boolean,
): TemplateResult | typeof nothing {
    const layer = host.opacity;
    return layer === null || hidden || !reveal.shown ? nothing : opacityCard(layer, host.locale, reveal, host);
}

/** Puts the card above the thumb (beside it standing), clear of the card's ends and the viewport's edges (`placeTip`). */
export function placeOpacityCard(host: HTMLElement & OpacityHost, rtl: boolean, vertical: boolean): void {
    const card = host.renderRoot.querySelector<HTMLElement>('.opacity');
    const thumb = host.renderRoot.querySelector('.thumb');
    if (card === null || thumb === null) {
        return;
    }
    const box = host.getBoundingClientRect();
    const mark = thumb.getBoundingClientRect();
    const anchor = { x: mark.left + mark.width / 2 - box.left, y: mark.top + mark.height / 2 - box.top };
    const place = placeTip(anchor, { width: card.offsetWidth, height: card.offsetHeight }, box, {
        width: innerWidth,
        height: innerHeight,
        rtl,
        vertical,
    });
    card.style.left = `${String(place.left)}px`;
    card.style.top = `${String(place.top - (vertical ? 0 : mark.height / 2))}px`;
}
