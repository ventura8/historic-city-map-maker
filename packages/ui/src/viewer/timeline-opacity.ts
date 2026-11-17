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

import { defineHcmSlider } from '../components/slider.js';
import { placeTip } from './timeline-tip.js';

defineHcmSlider();

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
    }

    readonly onEnter = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') {
            this.show();
        }
    };

    readonly onLeave = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') {
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
        if (!this.#within(event.relatedTarget)) {
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
function opacityCard(
    layer: YearOpacity,
    locale: ViewerLocale,
    reveal: OpacityReveal,
    { host, hidden }: { readonly host: EventTarget; readonly hidden: boolean },
): TemplateResult {
    const percent = Math.round(layer.opacity * 100);
    // The kit's slider, as in the Layers panel: its track and handle keep 3:1 against the card (WCAG 1.4.11), a native
    // range did not (1.3:1, the tour's checkers). Its own events stop here; the timeline sends the panel's event.
    const send = (event: Event, final: boolean): void => {
        event.stopPropagation();
        const value = (event as CustomEvent<{ readonly value: number }>).detail.value / 100;
        host.dispatchEvent(new CustomEvent('hcm-overlay-opacity', { bubbles: true, detail: { id: layer.id, opacity: value, final } }));
    };
    return html`<div
        class="opacity"
        ?hidden=${hidden}
        @pointerenter=${reveal.onEnter}
        @pointerleave=${reveal.onLeave}
        @pointerdown=${(event: Event) => {
            event.stopPropagation();
        }}
        @focusout=${reveal.onFocusOut}
        @keydown=${reveal.onKeyDown}
    >
        <hcm-slider
            min="0"
            max="100"
            step="1"
            .value=${percent}
            label=${translate(locale, 'layers.opacity', { name: layer.name })}
            value-text=${translate(locale, 'layers.opacityValue', { percent: String(percent) })}
            @hcm-input=${(event: Event) => {
                send(event, false);
            }}
            @hcm-change=${(event: Event) => {
                send(event, true);
            }}
        ></hcm-slider>
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
    return layer === null ? nothing : opacityCard(layer, host.locale, reveal, { host, hidden: hidden || !reveal.shown });
}

/** The card's centre (px from the timeline's left): past the thumb's end side, or its start side where the end has no room. */
function besideX(centreX: number, card: { readonly reach: number; readonly width: number; readonly left: number }, rtl: boolean): number {
    const { reach, width, left } = card;
    const fits = (x: number): boolean => x - width / 2 + left >= 8 && x + width / 2 + left <= innerWidth - 8;
    const [first, second] = rtl ? [centreX - reach, centreX + reach] : [centreX + reach, centreX - reach];
    return [first, second].find(fits) ?? first;
}

/**
 * Puts the card above the thumb and past its end (before it right to left; beside a standing timeline), clear of the
 * card's ends and the viewport's edges (`placeTip`). Never straight above the thumb: Tab goes from the thumb to the card,
 * and a stop straight above would be a step back up the column (the tour's focus order). Where the end side has no
 * room it goes to the other side.
 */
export function placeOpacityCard(host: HTMLElement & OpacityHost, rtl: boolean, vertical: boolean): void {
    const card = host.renderRoot.querySelector<HTMLElement>('.opacity');
    const thumb = host.renderRoot.querySelector('.thumb');
    if (card === null || thumb === null) {
        return;
    }
    const box = host.getBoundingClientRect();
    const mark = thumb.getBoundingClientRect();
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const centreX = mark.left + mark.width / 2 - box.left;
    const x = vertical ? centreX : besideX(centreX, { reach: mark.width / 2 + size.width / 2 + 4, width: size.width, left: box.left }, rtl);
    const anchor = { x, y: mark.top + mark.height / 2 - box.top };
    const place = placeTip(anchor, size, box, { width: innerWidth, height: innerHeight, rtl, vertical });
    card.style.left = `${String(place.left)}px`;
    card.style.top = `${String(place.top - (vertical ? 0 : mark.height / 2))}px`;
}
