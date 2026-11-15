/**
 * `<hcm-photos-control>`: the Photos switch of the Layers panel, directly under the Map labels' POIs switch and in its
 * style (the owner, 2026-11-15, design B). The switch shows or hides every photo marker (`hcm-overlay-visibility` with
 * `{id: 'photos', visible}`, the same event as the list's row, so the hash keeps it). A chevron beside it (a 48 px target),
 * a long press or a right-click on the row, or ArrowDown / Alt+ArrowDown on the switch opens a small popover: a radio
 * group "All photos" / "Only near the selected year" and one of ±5, ±10 (the default) or ±25 years. Each choice fires
 * `hcm-photos-near` with `{near}` (null: every photo). Esc closes the popover and gives the focus back to the chevron. While
 * near-year is on, a calendar badge sits on the row.
 */
import { PHOTO_YEAR_WINDOW, PHOTOS_NEAR_WINDOWS, PHOTOS_OVERLAY_ID, translate, DEFAULT_LOCALE, type ViewerLocale } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { baseStyles } from './shared-styles.js';

export const HCM_PHOTOS_CONTROL_TAG = 'hcm-photos-control';

/** How long a finger rests on the row before the popover opens. */
export const LONG_PRESS_MS = 500;

/** `hcm-photos-near`: the visitor's scope; null shows every photo. */
export interface PhotosNearDetail {
    readonly near: number | null;
}

export class HcmPhotosControl extends LitElement {
    static override readonly properties = {
        visible: { type: Boolean },
        near: { attribute: false },
        locale: { type: String },
        open: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        css`
            :host {
                display: block;
            }

            .row {
                display: flex;
                gap: 8px;
                align-items: center;

                /* The row is at least 48 px: the switch's and the chevron's targets stay their own (docs/LESSONS.md 618). */
                min-block-size: 48px;
                -webkit-touch-callout: none;
                user-select: none;
            }

            .name {
                flex: 1;
            }

            .badge {
                display: inline-flex;
                color: var(--md-sys-color-primary);
            }

            .chevron {
                display: inline-grid;
                place-items: center;
                inline-size: 48px;
                block-size: 48px;
                padding: 0;
                border: 0;
                border-radius: var(--md-sys-shape-corner-full);
                background: none;
                color: var(--md-sys-color-on-surface-variant);
                font: inherit;
            }

            .chevron:focus-visible,
            input:focus-visible {
                outline: 3px solid var(--md-sys-color-secondary);
                outline-offset: 2px;
            }

            .popover {
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding: 8px 12px;
                border-radius: var(--md-sys-shape-corner-medium);
                background: var(--md-sys-color-surface-container-high);
                color: var(--md-sys-color-on-surface);
                box-shadow: var(--md-sys-elevation-level2);
            }

            .popover h4 {
                color: var(--md-sys-color-on-surface-variant);
                font-size: var(--md-sys-typescale-label-medium-size);
            }

            .choices {
                display: flex;
                flex-wrap: wrap;
                gap: 0 12px;
            }

            label {
                display: inline-flex;
                gap: 8px;
                align-items: center;
                min-block-size: 44px;
            }

            input {
                inline-size: 20px;
                block-size: 20px;
                margin: 0;
                accent-color: var(--md-sys-color-primary);
            }
        `,
    ];

    declare visible: boolean;
    declare near: number | null;
    declare locale: ViewerLocale;
    declare open: boolean;

    #press: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        super();
        this.visible = true;
        this.near = null;
        this.locale = DEFAULT_LOCALE;
        this.open = false;
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#endPress();
    }

    override render(): TemplateResult {
        const name = translate(this.locale, 'layers.photos');
        return html`<div
                class="row"
                @contextmenu=${this.#onContextMenu}
                @pointerdown=${this.#startPress}
                @pointerup=${this.#endPress}
                @pointercancel=${this.#endPress}
                @pointerleave=${this.#endPress}
            >
                <span class="name">${name}</span>${this.#badge()}
                <button
                    class="chevron"
                    type="button"
                    aria-haspopup="true"
                    aria-expanded=${this.open ? 'true' : 'false'}
                    aria-controls="photos-scope"
                    aria-label=${translate(this.locale, 'photosScope.options')}
                    title=${translate(this.locale, 'photosScope.options')}
                    @click=${this.#toggleOpen}
                >
                    <hcm-icon name=${this.open ? 'expand_less' : 'expand_more'}></hcm-icon>
                </button>
                <hcm-switch
                    .checked=${this.visible}
                    .label=${name}
                    @hcm-change=${this.#onSwitch}
                    @keydown=${this.#onSwitchKey}
                ></hcm-switch>
            </div>
            ${this.open ? this.#popover() : nothing}`;
    }

    #badge(): TemplateResult {
        if (this.near === null) {
            return EMPTY;
        }
        const label = translate(this.locale, 'photosScope.nearOn', { years: String(this.near) });
        return html`<span class="badge" role="img" aria-label=${label} title=${label}><hcm-icon name="event"></hcm-icon></span>`;
    }

    #popover(): TemplateResult {
        const window = this.near ?? PHOTO_YEAR_WINDOW;
        return html`<div id="photos-scope" class="popover" @keydown=${this.#onPopoverKey}>
            <div class="choices" role="radiogroup" aria-label=${translate(this.locale, 'photosScope.options')}>
                ${this.#radio('scope', translate(this.locale, 'photosScope.all'), this.near === null, null)}
                ${this.#radio('scope', translate(this.locale, 'photosScope.near'), this.near !== null, window)}
            </div>
            <h4 id="photos-window">${translate(this.locale, 'photosScope.window')}</h4>
            <div class="choices" role="radiogroup" aria-labelledby="photos-window">
                ${PHOTOS_NEAR_WINDOWS.map((years) =>
                    this.#radio('window', translate(this.locale, 'photosScope.years', { years: String(years) }), years === window, years),
                )}
            </div>
        </div>`;
    }

    #radio(group: string, text: string, checked: boolean, near: number | null): TemplateResult {
        const onChange = (): void => {
            this.#setNear(near);
        };
        return html`<label><input type="radio" name=${group} .checked=${checked} @change=${onChange} />${text}</label>`;
    }

    #setNear(near: number | null): void {
        const detail: PhotosNearDetail = { near };
        this.dispatchEvent(new CustomEvent('hcm-photos-near', { bubbles: true, composed: true, detail }));
    }

    readonly #onSwitch = (event: CustomEvent<{ readonly checked: boolean }>): void => {
        event.stopPropagation();
        const detail = { id: PHOTOS_OVERLAY_ID, visible: event.detail.checked };
        this.dispatchEvent(new CustomEvent('hcm-overlay-visibility', { bubbles: true, composed: true, detail }));
    };

    readonly #onSwitchKey = (event: KeyboardEvent): void => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.#show();
        }
    };

    readonly #onPopoverKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.open = false;
            void this.updateComplete.then(() => {
                this.renderRoot.querySelector<HTMLButtonElement>('.chevron')?.focus();
            });
        }
    };

    readonly #toggleOpen = (): void => {
        if (this.open) {
            this.open = false;
            return;
        }
        this.#show();
    };

    readonly #onContextMenu = (event: Event): void => {
        event.preventDefault();
        this.#show();
    };

    readonly #startPress = (event: PointerEvent): void => {
        if (event.pointerType !== 'touch') {
            return;
        }
        this.#endPress();
        this.#press = setTimeout(() => {
            this.#press = null;
            this.#show();
        }, LONG_PRESS_MS);
    };

    readonly #endPress = (): void => {
        if (this.#press !== null) {
            clearTimeout(this.#press);
            this.#press = null;
        }
    };

    /** Opens the popover and puts the focus on its checked choice. */
    #show(): void {
        this.open = true;
        void this.updateComplete.then(() => {
            this.renderRoot.querySelector<HTMLInputElement>('input[name="scope"]:checked')?.focus();
        });
    }
}

/** Registers `<hcm-photos-control>` once; calling it again is a no-op. */
export function defineHcmPhotosControl(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_PHOTOS_CONTROL_TAG) === undefined) {
        registry.define(HCM_PHOTOS_CONTROL_TAG, HcmPhotosControl);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-photos-control': HcmPhotosControl;
    }
}
