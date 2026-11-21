/**
 * `<hcm-compare>`: swipe compare's surface over the viewer's map (M4, docs/research/M4-interfaces.md §3.5–§3.7, scenario
 * V06). In `swipe` mode it holds the second map's container (clipped to the right of the divider, inert: the viewer's map
 * under it takes every gesture), the divider (a slider for the keyboard and screen readers, dragged with a pointer) and
 * the compare bar (the main side's name, the chooser of the compared side, Close, the compared layer's source); in
 * `toggle` mode (a compact window) only the bar, whose two-way toggle switches the one map between the two sides.
 *
 * It keeps a drag to itself (the clip follows the pointer at once) and tells the session only where the divider settles:
 * on release, on a key, on the toggle. Created by `createCompareUi` (`compare-ui.ts`) in the engine's lazy compare chunk;
 * no decorators, `hcm-` prefix, an idempotent `defineHcmCompare`, inline styles only through the CSSOM.
 */
import { translate } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import { defineOnce } from '../../components/internal.js';
import type { SegmentOption } from '../../components/segmented-button.js';
import { EMPTY } from '../empty.js';
import { baseStyles, focusRing } from '../../components/styles.js';
import type { CompareUiEvents, CompareUiProps } from './compare-types.js';
import { compareStyles } from './compare-styles.js';
import { dividerKey, dividerPercent, draggedPosition } from './divider.js';

export const HCM_COMPARE_TAG = 'hcm-compare';

/** Where a drag started: the pointer's x and the divider's position then. */
interface Drag {
    readonly pointerId: number;
    readonly x: number;
    readonly start: number;
}

const NO_EVENTS: CompareUiEvents = { onPosition: () => undefined, onChoose: () => undefined, onClose: () => undefined };

/** The `<select>` value of a side: its layer id, `''` for today (no layer id is empty). */
function choiceValue(layerId: string | null): string {
    return layerId ?? '';
}

export class HcmCompare extends LitElement {
    static override readonly properties = {
        props: { attribute: false },
        live: { state: true },
    };

    static override readonly styles = [baseStyles, focusRing, compareStyles];

    /** What to show; nothing renders before the session sets it. */
    declare props: CompareUiProps | null;
    /** The divider while a pointer drags it (null otherwise). */
    declare live: number | null;
    /** mapbox-gl.css, linked beside the second map (`''`: none, the unit tests). */
    mapboxCssUrl = '';
    events: CompareUiEvents = NO_EVENTS;

    #drag: Drag | null = null;
    /** mapbox-gl.css has loaded (or failed: the map is drawn anyway), and who waits for it. */
    #cssReady = false;
    readonly #cssWaiters: (() => void)[] = [];

    constructor() {
        super();
        this.props = null;
        this.live = null;
    }

    /** The second map's container once it is drawn and mapbox-gl.css has loaded; null outside swipe mode. */
    async mapContainer(): Promise<HTMLElement | null> {
        await this.updateComplete;
        if (this.mapboxCssUrl === '') {
            this.#cssLoaded();
        }
        await this.#whenCss();
        return this.isConnected && this.props?.mode === 'swipe' ? this.renderRoot.querySelector<HTMLElement>('.second') : null;
    }

    #cssLoaded(): void {
        this.#cssReady = true;
        for (const resume of this.#cssWaiters.splice(0)) {
            resume();
        }
    }

    #whenCss(): Promise<void> {
        return this.#cssReady
            ? Promise.resolve()
            : new Promise((resolve) => {
                  this.#cssWaiters.push(resolve);
              });
    }

    /** A drag cut short by a switch to the toggle (a narrower window) ends there: a later swipe starts afresh. */
    protected override willUpdate(): void {
        if (this.props?.mode !== 'swipe') {
            this.#drag = null;
            this.live = null;
        }
    }

    protected override updated(): void {
        const props = this.props;
        if (props !== null) {
            this.setAttribute('mode', props.mode);
            this.style.setProperty('--hcm-compare-at', `${String(dividerPercent(this.live ?? props.position))}%`);
        }
    }

    override render(): TemplateResult {
        const props = this.props;
        if (props === null) {
            return EMPTY;
        }
        const swipe = props.mode === 'swipe';
        return html`${this.#stylesheet()} ${this.#secondMap()} ${this.#bar(props)} ${swipe ? this.#handle(props) : EMPTY}`;
    }

    #stylesheet(): TemplateResult {
        const loaded = (): void => {
            this.#cssLoaded();
        };
        return this.mapboxCssUrl === ''
            ? EMPTY
            : html`<link rel="stylesheet" href=${this.mapboxCssUrl} @load=${loaded} @error=${loaded} />`;
    }

    /**
     * The second map's container: inert, clipped to the right of the divider (`--hcm-compare-at`). It stays in toggle
     * mode, hidden (not removed, not sized to nothing), so a second map the session parks there for a while keeps its
     * container and is shown again as it was when the window widens.
     */
    #secondMap(): TemplateResult {
        return html`<div class="second" inert></div>`;
    }

    #comparedLabel(props: CompareUiProps): string {
        return props.choices.find((choice) => choice.layerId === props.layerId)?.label ?? '';
    }

    #bar(props: CompareUiProps): TemplateResult {
        const t = (key: Parameters<typeof translate>[1]): string => translate(props.locale, key);
        return html`<div class="bar" role="group" aria-label=${t('compare.title')} data-layout-check="compare-bar">
            ${props.mode === 'swipe' ? html`<span class="side"><hcm-icon name="compare"></hcm-icon>${props.mainLabel}</span>` : this.#toggle(props)}
            <select aria-label=${t('compare.choose')} @change=${this.#onChoose}>
                ${props.choices.map(
                    (choice) =>
                        html`<option value=${choiceValue(choice.layerId)} .selected=${choice.layerId === props.layerId}>
                            ${choice.label}
                        </option>`,
                )}
            </select>
            <hcm-icon-button icon="close" .label=${t('compare.close')} @click=${this.#onClose}></hcm-icon-button>
            ${this.#credit(props.credit)}
        </div>`;
    }

    #credit(credit: string): TemplateResult {
        return credit === '' ? EMPTY : html`<p class="credit">${credit}</p>`;
    }

    #toggle(props: CompareUiProps): TemplateResult {
        const options: readonly SegmentOption[] = [
            { value: 'main', label: props.mainLabel },
            { value: 'compared', label: this.#comparedLabel(props) },
        ];
        return html`<hcm-segmented-button
            .options=${options}
            .value=${props.position > 0 ? 'main' : 'compared'}
            .label=${translate(props.locale, 'compare.toggle')}
            @hcm-change=${this.#onToggle}
        ></hcm-segmented-button>`;
    }

    #handle(props: CompareUiProps): TemplateResult {
        const percent = dividerPercent(this.live ?? props.position);
        const text = translate(props.locale, 'compare.value', {
            left: props.mainLabel,
            a: String(percent),
            right: this.#comparedLabel(props),
            b: String(100 - percent),
        });
        return html`<div class="line"></div>
            <div
                class="handle"
                role="slider"
                tabindex="0"
                aria-label=${translate(props.locale, 'compare.divider')}
                aria-orientation="horizontal"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow=${percent}
                aria-valuetext=${text}
                data-layout-check="compare-handle"
                @keydown=${(event: KeyboardEvent) => {
                    this.#onKeyDown(event, props.position);
                }}
                @pointerdown=${(event: PointerEvent) => {
                    this.#onPointerDown(event, props.position);
                }}
                @pointermove=${this.#onPointerMove}
                @pointerup=${this.#onPointerUp}
                @pointercancel=${this.#onPointerUp}
            >
                <hcm-icon name="compare"></hcm-icon>
            </div>`;
    }

    readonly #onChoose = (event: Event): void => {
        const value = (event.target as HTMLSelectElement).value;
        this.events.onChoose(value === '' ? null : value);
    };

    readonly #onClose = (event: Event): void => {
        event.stopPropagation();
        this.events.onClose();
    };

    readonly #onToggle = (event: CustomEvent<{ readonly value: string }>): void => {
        event.stopPropagation();
        this.events.onPosition(event.detail.value === 'main' ? 1 : 0);
    };

    /** The divider's keys (`dividerKey`); Esc closes compare. */
    #onKeyDown(event: KeyboardEvent, position: number): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.events.onClose();
            return;
        }
        const next = dividerKey(event.key, event.shiftKey, position);
        if (next !== null) {
            event.preventDefault();
            this.events.onPosition(next);
        }
    }

    /** A drag starts on the handle; a second pointer meanwhile is ignored. */
    #onPointerDown(event: PointerEvent, position: number): void {
        if (this.#drag !== null) {
            return;
        }
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        this.#drag = { pointerId: event.pointerId, x: event.clientX, start: position };
        this.live = position;
        event.preventDefault();
    }

    readonly #onPointerMove = (event: PointerEvent): void => {
        const drag = this.#drag;
        if (drag?.pointerId === event.pointerId) {
            this.live = draggedPosition(drag.start, event.clientX - drag.x, this.getBoundingClientRect().width);
        }
    };

    readonly #onPointerUp = (event: PointerEvent): void => {
        const drag = this.#drag;
        if (drag?.pointerId !== event.pointerId) {
            return;
        }
        const settled = draggedPosition(drag.start, event.clientX - drag.x, this.getBoundingClientRect().width);
        this.#drag = null;
        this.live = null;
        this.events.onPosition(settled);
    };
}

/** Registers `<hcm-compare>` once; calling it again is a no-op. */
export function defineHcmCompare(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_COMPARE_TAG, HcmCompare);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-compare': HcmCompare;
    }
}
