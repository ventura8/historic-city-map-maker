import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { deepActiveElement, restoreFocus, trapTab } from './focus.js';
import { defineHcmIconButton } from './icon-button.js';
import { defineOnce, emit } from './internal.js';
import { baseStyles, focusRing, touchTarget, typeStyles } from './styles.js';

export const HCM_SHEET_TAG = 'hcm-sheet';

export type SheetVariant = 'bottom' | 'side';
export type SheetDetent = 'peek' | 'half' | 'full';

/** The bottom sheet's heights, smallest first: the drag handle cycles through them. */
export const SHEET_DETENTS: readonly SheetDetent[] = ['peek', 'half', 'full'];

/** M3: a full-height bottom sheet keeps 72 px of the map above it. */
const FULL_TOP_MARGIN_PX = 72;
const PEEK_MAX_PX = 160;
/** A drag shorter than this is a tap on the handle (which cycles the heights). */
const DRAG_SLOP_PX = 4;
type DetentMap = Readonly<Record<SheetDetent, SheetDetent>>;

/** A tap on the handle: the next height, wrapping. */
const NEXT_DETENT: DetentMap = { peek: 'half', half: 'full', full: 'peek' };
/** Arrow keys on the handle: one height up or down, stopping at the ends. */
const HANDLE_KEYS: Readonly<Record<string, DetentMap>> = {
    ArrowUp: { peek: 'half', half: 'full', full: 'full' },
    ArrowDown: { peek: 'peek', half: 'peek', full: 'half' },
};

/** The pixel height of each detent in a container `containerHeight` px tall (the CSS of the sheet, in numbers). */
export function detentHeights(containerHeight: number): Readonly<Record<SheetDetent, number>> {
    return {
        peek: Math.min(PEEK_MAX_PX, containerHeight * 0.3),
        half: containerHeight * 0.5,
        full: Math.max(0, containerHeight - FULL_TOP_MARGIN_PX),
    };
}

/** Where a released drag settles: the nearest detent, or null (close) below half the peek height. */
export function settleDetent(height: number, containerHeight: number): SheetDetent | null {
    const heights = detentHeights(containerHeight);
    if (height < heights.peek / 2) {
        return null;
    }
    return SHEET_DETENTS.reduce((best, detent) => (Math.abs(heights[detent] - height) < Math.abs(heights[best] - height) ? detent : best));
}

/**
 * An M3 sheet: `bottom` on compact windows (drag handle, three heights), `side` from medium (on the inline end). It
 * covers its positioned container (the map); a `modal` sheet adds a scrim, traps Tab and is a dialog, a standard one
 * is a labelled region next to the live map. Opening moves the focus into the sheet, closing returns it to the opener.
 * Esc, the close button, the scrim or a drag below the lowest height close it and fire `hcm-close`; a new height
 * fires `hcm-detent-change` with `{detent}`. Slots: `header`, default, `actions`; the actions' row takes no room while
 * nothing is slotted there (its empty padding sat over the end of the content). The header row is a plain box, not a
 * `header`: inside a dialog it is no page banner (axe found a second banner under the lightbox).
 */
export class HcmSheet extends LitElement {
    static override readonly properties = {
        open: { type: Boolean, reflect: true },
        label: { type: String },
        variant: { type: String, reflect: true },
        closeLabel: { type: String, attribute: 'close-label' },
        handleLabel: { type: String, attribute: 'handle-label' },
        modal: { type: Boolean, reflect: true },
        detent: { type: String, reflect: true },
        hasActions: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        touchTarget,
        typeStyles,
        css`
            :host {
                position: absolute;
                inset: 0;
                z-index: var(--hcm-sheet-z-index, 2);
                display: block;
                pointer-events: none;

                --hcm-sheet-height: 50%;
            }

            :host(:not([open])) {
                display: none;
            }

            :host([detent='peek']) {
                --hcm-sheet-height: min(10rem, 30%);
            }

            :host([detent='full']) {
                --hcm-sheet-height: calc(100% - 72px);
            }

            .scrim {
                position: absolute;
                inset: 0;
                background: color-mix(in srgb, var(--md-sys-color-scrim) 32%, transparent);
                pointer-events: auto;
            }

            .sheet {
                position: absolute;
                display: flex;
                flex-direction: column;
                box-sizing: border-box;
                overflow: clip;
                background: var(--md-sys-color-surface-container-low);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level1);
                pointer-events: auto;
                transition:
                    height var(--md-sys-motion-spring-default-spatial-duration) var(--md-sys-motion-spring-default-spatial-easing),
                    transform var(--md-sys-motion-spring-default-spatial-duration) var(--md-sys-motion-spring-default-spatial-easing);
            }

            .sheet:focus {
                outline: none;
            }

            :host([variant='bottom']) .sheet {
                inset-inline: 0;
                bottom: 0;
                max-width: 640px;
                height: var(--hcm-sheet-height);
                margin-inline: auto;
                border-radius: var(--md-sys-shape-corner-extra-large) var(--md-sys-shape-corner-extra-large) 0 0;
            }

            :host([variant='side']) .sheet {
                inset-block: 0;
                inset-inline-end: 0;
                width: min(var(--hcm-sheet-width, 360px), 100%);
                border-start-start-radius: var(--md-sys-shape-corner-large);
                border-end-start-radius: var(--md-sys-shape-corner-large);
            }

            @starting-style {
                :host([variant='bottom']) .sheet {
                    transform: translateY(100%);
                }

                :host([variant='side']) .sheet {
                    transform: translateX(100%);
                }

                /* Right to left the side sheet sits at the left edge (inset-inline-end) and enters from there. */
                :host([variant='side']:dir(rtl)) .sheet {
                    transform: translateX(-100%);
                }
            }

            .sheet.dragging {
                transition: none;
            }

            /*
             * M3's drag handle: a 32 × 4 bar in a 48 × 48 target at the top of the sheet. The target is the button itself:
             * a 24 px button's centred 48 px ring rose 12 px above it and the sheet, which hides its overflow, cut it to
             * 36 px (the tour's hit-tested target size).
             */
            .handle {
                position: relative;
                display: grid;
                flex: none;
                place-items: center;
                align-self: center;
                width: 48px;
                height: 48px;
                padding: 0;
                margin: 0;
                border: none;
                background: none;
                cursor: grab;
                touch-action: none;
            }

            /* A round ring inside the handle's box: the sheet hides its overflow, and a ring past its top edge was cut. */
            .handle:focus-visible {
                border-radius: var(--md-sys-shape-corner-full);
                outline-offset: -4px;
            }

            .bar {
                width: 32px;
                height: 4px;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--md-sys-color-on-surface-variant);
                opacity: 0.4;
            }

            .header {
                display: flex;
                gap: 8px;
                align-items: center;
                padding: 8px 8px 8px 24px;
            }

            /* Below the 48 px handle the header needs no space of its own above it. */
            .handle + .header {
                padding-block-start: 0;
            }

            .title {
                flex: 1 1 auto;
                min-width: 0;
            }

            /*
             * The close button's own box is the 48 px target (the owner's iPhone, 2026-11-15): the ring drawn past a 40 px
             * button was not hit below it in WebKit, where a tap there reached the header instead (lesson 740).
             */
            .header hcm-icon-button {
                --hcm-control-size: 48px;
            }

            .content {
                flex: 1 1 auto;
                padding: 0 24px 16px;
                overflow: auto;
                overscroll-behavior: contain;

                /* M3 thin scrollbar, themed with the tokens (light and dark). */
                scrollbar-width: thin;
                scrollbar-color: var(--md-sys-color-outline-variant) transparent;
            }

            .actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                justify-content: flex-end;
                padding: 0 24px 16px;
            }

            @media (forced-colors: active) {
                .sheet {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    declare open: boolean;
    declare label: string;
    declare variant: SheetVariant;
    declare closeLabel: string;
    declare handleLabel: string;
    declare modal: boolean;
    declare detent: SheetDetent;
    /** Whether anything is slotted into `actions` (the row is hidden otherwise). */
    declare hasActions: boolean;

    private opener: Element | null = null;
    /** Ends the drag in progress (removes its listeners); null when the handle is not being dragged. */
    private stopDrag: (() => void) | null = null;
    private suppressClick = false;

    constructor() {
        super();
        this.open = false;
        this.label = '';
        this.variant = 'bottom';
        this.closeLabel = '';
        this.handleLabel = '';
        this.modal = false;
        this.detent = 'half';
        this.hasActions = false;
    }

    /** Closes the sheet and fires `hcm-close` (what Esc, the close button and the scrim do). */
    close(): void {
        if (this.open) {
            this.open = false;
            emit(this, 'hcm-close');
        }
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.stopDrag?.();
    }

    protected override updated(changed: PropertyValues<this>): void {
        if (!changed.has('open')) {
            return;
        }
        if (this.open) {
            this.opener = deepActiveElement(this.ownerDocument);
            // Not scrolled to: it still lies past the edge it slides in from, and a box around it scrolled by its height.
            this.sheet()?.focus({ preventScroll: true });
        } else if (changed.get('open') === true) {
            restoreFocus(this.opener);
            this.opener = null;
        }
    }

    override render(): TemplateResult {
        return html`${this.renderScrim()}
            <section
                class="sheet"
                part="sheet"
                role=${this.modal ? 'dialog' : 'region'}
                aria-modal=${this.modal ? 'true' : nothing}
                aria-label=${this.label}
                tabindex="-1"
                @keydown=${this.onKeyDown}
            >
                ${this.renderHandle()}
                <div class="header">
                    <div class="title title-medium"><slot name="header"></slot></div>
                    <hcm-icon-button icon="close" label=${this.closeLabel} @click=${this.onCloseClick}></hcm-icon-button>
                </div>
                <div class="content body-medium"><slot></slot></div>
                <div class="actions" ?hidden=${!this.hasActions}><slot name="actions" @slotchange=${this.onActionsChange}></slot></div>
            </section>`;
    }

    private readonly onActionsChange = (event: Event): void => {
        this.hasActions = (event.target as HTMLSlotElement).assignedNodes().length > 0;
    };

    private renderScrim(): TemplateResult {
        return this.modal ? html`<div class="scrim" part="scrim" @click=${this.onScrimClick}></div>` : html``;
    }

    private renderHandle(): TemplateResult {
        if (this.variant !== 'bottom') {
            return html``;
        }
        return html`<button
            class="handle touch-target"
            part="handle"
            aria-label=${this.handleLabel}
            @click=${this.onHandleClick}
            @keydown=${this.onHandleKeyDown}
            @pointerdown=${this.onHandlePointerDown}
        >
            <span class="bar"></span>
        </button>`;
    }

    /** The sheet's own surface, what covers the map (the viewer's Locate keeps a photo's place beside it). */
    sheet(): HTMLElement | null {
        return this.renderRoot.querySelector<HTMLElement>('.sheet');
    }

    private setDetent(detent: SheetDetent): void {
        if (detent !== this.detent) {
            this.detent = detent;
            emit(this, 'hcm-detent-change', { detent });
        }
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            this.close();
        } else if (this.modal) {
            trapTab(event, event.currentTarget as HTMLElement);
        }
    };

    private readonly onScrimClick = (): void => {
        this.close();
    };

    private readonly onCloseClick = (): void => {
        this.close();
    };

    private readonly onHandleClick = (): void => {
        if (this.suppressClick) {
            this.suppressClick = false;
            return;
        }
        this.setDetent(NEXT_DETENT[this.detent]);
    };

    private readonly onHandleKeyDown = (event: KeyboardEvent): void => {
        const steps = HANDLE_KEYS[event.key];
        if (steps !== undefined) {
            event.preventDefault();
            this.setDetent(steps[this.detent]);
        }
    };

    private readonly onHandlePointerDown = (event: PointerEvent): void => {
        const sheet = this.sheet();
        if (event.button === 0 && sheet !== null) {
            this.startDrag(sheet, event.clientY);
        }
    };

    /** Follows the pointer with the sheet's height until release, then settles (only after a real drag). */
    private startDrag(sheet: HTMLElement, startY: number): void {
        const doc = this.ownerDocument;
        const startHeight = sheet.getBoundingClientRect().height;
        let moved = false;
        const move = (event: PointerEvent): void => {
            const delta = startY - event.clientY;
            moved ||= Math.abs(delta) > DRAG_SLOP_PX;
            sheet.style.setProperty('height', `${String(Math.max(0, startHeight + delta))}px`);
        };
        const up = (): void => {
            const height = sheet.getBoundingClientRect().height;
            stop();
            if (moved) {
                this.settle(height);
            }
        };
        const stop = (): void => {
            doc.removeEventListener('pointermove', move);
            doc.removeEventListener('pointerup', up);
            doc.removeEventListener('pointercancel', up);
            sheet.classList.remove('dragging');
            sheet.style.removeProperty('height');
            this.stopDrag = null;
        };
        sheet.classList.add('dragging');
        doc.addEventListener('pointermove', move);
        doc.addEventListener('pointerup', up);
        doc.addEventListener('pointercancel', up);
        this.stopDrag = stop;
    }

    /** After a real drag: snap to the nearest height or close; the click that ends the drag is not a tap. */
    private settle(height: number): void {
        // The click is dispatched in this same task, so a zero timeout outlives exactly that click.
        this.suppressClick = true;
        setTimeout(() => {
            this.suppressClick = false;
        }, 0);
        const detent = settleDetent(height, this.getBoundingClientRect().height);
        if (detent === null) {
            this.close();
        } else {
            this.setDetent(detent);
        }
    }
}

export function defineHcmSheet(registry: CustomElementRegistry = customElements): void {
    defineHcmIconButton(registry);
    defineOnce(registry, HCM_SHEET_TAG, HcmSheet);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-sheet': HcmSheet;
    }
}
