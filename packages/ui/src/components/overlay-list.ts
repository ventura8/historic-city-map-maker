import { opacityPercent, type OverlayKind } from '@hcm/shared';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { cssProperties } from './css-properties.js';
import { defineHcmIcon } from './icon.js';
import { defineOnce, emit, fillTemplate } from './internal.js';
import { defineHcmSlider } from './slider.js';
import { baseStyles, typeStyles, visuallyHidden } from './styles.js';
import { defineHcmSwitch } from './switch.js';

export const HCM_OVERLAY_LIST_TAG = 'hcm-overlay-list';

/** How long a revealed row stays marked: its tint's 1.6 s fade. */
export const REVEAL_MS = 1600;

/** One overlay row: labels already localized, `opacity` 0..1, `color`/`icon` for a POI category's swatch. */
export interface OverlayListItem {
    readonly id: string;
    readonly kind: OverlayKind;
    readonly label: string;
    readonly visible: boolean;
    readonly opacity: number;
    /** `#rrggbb` (validated by the manifest schema). */
    readonly color?: string;
    /** A bundled Material Symbols name. */
    readonly icon?: string;
    /**
     * Whether the row has the visibility switch (default true). The admin's overlay defaults list the photos and the POI
     * categories without one: only a historical layer has a "shown at start" (CR-M2c-10).
     */
    readonly toggleable?: boolean;
    /**
     * A secondary line below the name, in smaller supporting text (the viewer's historical layer: its date or year). The
     * two lines fit the row's 48 px when the name fits its line; a longer name wraps and the row grows (never cut).
     */
    readonly detail?: string;
}

/** A group heading (`layers.group.historical`, `layers.group.places`); a kind without one is listed without heading. */
export interface OverlayListGroup {
    readonly kind: OverlayKind;
    readonly label: string;
}

interface Segment {
    readonly heading: string | null;
    readonly items: readonly OverlayListItem[];
}

/** The `checked` of an inner switch's `hcm-change`, which stops here (the list fires its own events). */
function checkedOf(event: Event): boolean {
    event.stopPropagation();
    return (event as CustomEvent<{ checked: boolean }>).detail.checked;
}

/** The `value` of an inner slider's `hcm-input` / `hcm-change`, which stops here. */
function valueOf(event: Event): number {
    event.stopPropagation();
    return (event as CustomEvent<{ value: number }>).detail.value;
}

/**
 * The live-transparency list of PLAN Addendum 3, shared by the viewer's Layers panel and the admin's default-opacity
 * editor: per overlay a switch (`toggleLabel`, "Show {name}"; none on a row whose `toggleable` is false) and a 0–100 %
 * slider (`opacityLabel`; arrows ±1, PageUp/PageDown ±10, Home/End; `aria-valuetext` and the visible value from
 * `valueText`, "{percent} %"). A hidden
 * overlay keeps its slider enabled. Fires `hcm-overlay-visibility` with `{id, visible}` and `hcm-overlay-opacity` with
 * `{id, opacity, final}` (`final: false` per frame while dragging or per key press, `true` on release); once a change
 * settles, `changedText` (and `shownText` / `hiddenText` for the switch) is announced in a polite live region. The
 * list is controlled: it shows `items` as given, so the app feeds its new state back. `disabled` (the admin's read-only
 * page) leaves every switch and slider showing its value without moving.
 */
export class HcmOverlayList extends LitElement {
    static override readonly properties = {
        items: { attribute: false },
        groups: { attribute: false },
        toggleLabel: { type: String, attribute: 'toggle-label' },
        opacityLabel: { type: String, attribute: 'opacity-label' },
        valueText: { type: String, attribute: 'value-text' },
        changedText: { type: String, attribute: 'changed-text' },
        shownText: { type: String, attribute: 'shown-text' },
        hiddenText: { type: String, attribute: 'hidden-text' },
        disabled: { type: Boolean, reflect: true },
        announcement: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        typeStyles,
        visuallyHidden,
        css`
            :host {
                display: block;
                color: var(--md-sys-color-on-surface);
            }

            h3 {
                margin: 8px 0 0;
                color: var(--md-sys-color-primary);
                font-size: var(--md-sys-typescale-title-small-size);
                font-weight: var(--md-sys-typescale-title-small-weight);
                line-height: var(--md-sys-typescale-title-small-line-height);
            }

            ul {
                display: flex;
                flex-direction: column;
                padding: 0;
                margin: 0;
                list-style: none;
            }

            li {
                display: grid;
                grid-template-columns: auto 1fr auto;
                gap: 0 8px;
                align-items: center;

                /* A row of 48 px each for the switch and the slider: their 48 px targets never overlap (M3's touch target). */
                grid-auto-rows: minmax(48px, auto);
            }

            .swatch {
                display: grid;
                place-items: center;
                width: 32px;
                height: 32px;
                border-radius: var(--md-sys-shape-corner-full);
                background: var(--swatch, var(--md-sys-color-secondary-container));
                color: var(--md-sys-color-on-secondary-container);

                --hcm-icon-size: 20px;
            }

            .swatch.colored {
                color: var(--md-sys-color-surface);
            }

            .name {
                min-width: 0;
                overflow-wrap: anywhere;
            }

            .name.dated {
                display: flex;
                flex-direction: column;
            }

            /*
             * Two lines in the row's 48 px: 20 + 16 px, the name a touch tighter than body-large's 24 px. A name longer than
             * its line wraps and the row grows, never an ellipsis: a cut name hides the layer's year under WCAG 1.4.12's text
             * spacing (the tour's clipped-text check, "Fotografie aeriană 1980" at 4K in a 211 px column).
             */
            .name.dated > .label {
                line-height: 20px;
            }

            .detail {
                color: var(--md-sys-color-on-surface-variant);
                font-size: var(--md-sys-typescale-body-small-size);
                line-height: 16px;
            }

            .opacity {
                display: flex;
                grid-column: 2 / -1;
                gap: 12px;
                align-items: center;
            }

            hcm-slider {
                flex: 1 1 auto;
            }

            .value {
                min-width: 3.5em;
                color: var(--md-sys-color-on-surface-variant);
                text-align: end;

                /* A revealed row lands under the Layers panel's sticky strip, never behind it (its height, set by the panel). */
                scroll-margin-block-start: var(--hcm-pinned-height, 0);
            }

            /* A row the timeline's year just turned on (\`reveal\`): a short primary tint that fades out. */
            li.revealed {
                border-radius: var(--md-sys-shape-corner-medium);
                animation: hcm-revealed 1.6s ease-out;
            }

            @keyframes hcm-revealed {
                from {
                    background: var(--md-sys-color-primary-container);
                }
            }

            @media (prefers-reduced-motion: reduce) {
                li.revealed {
                    animation: none;
                    background: var(--md-sys-color-primary-container);
                }
            }

            @media (forced-colors: active) {
                li.revealed {
                    outline: 2px solid Highlight;
                }

                .swatch {
                    border: 1px solid CanvasText;
                }
            }
        `,
    ];

    declare items: readonly OverlayListItem[];
    declare groups: readonly OverlayListGroup[];
    declare toggleLabel: string;
    declare opacityLabel: string;
    declare valueText: string;
    declare changedText: string;
    declare shownText: string;
    declare hiddenText: string;
    /** Every slider and switch shows its value and does not move (the admin's read-only page). */
    declare disabled: boolean;
    declare announcement: string;

    constructor() {
        super();
        this.items = [];
        this.groups = [];
        this.toggleLabel = '{name}';
        this.opacityLabel = '{name}';
        this.valueText = '{percent} %';
        this.changedText = '';
        this.shownText = '';
        this.hiddenText = '';
        this.disabled = false;
        this.announcement = '';
    }

    /**
     * Scrolls the first of these rows to the top of the view and marks them for a moment (the timeline's year turned them on; the
     * iPhone QA, 2026-11-15). Smooth unless the visitor asked for reduced motion; the focus never moves. False: no such row.
     */
    reveal(ids: readonly string[]): boolean {
        const rows = ids.flatMap((id) => [...this.renderRoot.querySelectorAll<HTMLElement>(`li[data-overlay="${CSS.escape(id)}"]`)]);
        const [first] = rows;
        if (first === undefined) {
            return false;
        }
        const reduce = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
        first.scrollIntoView({ block: 'start', behavior: reduce ? 'instant' : 'smooth' });
        for (const row of rows) {
            row.classList.remove('revealed');
            // A reflow restarts the tint when the same row is revealed twice in a row.
            row.getBoundingClientRect();
            row.classList.add('revealed');
        }
        globalThis.setTimeout(() => {
            for (const row of rows) {
                row.classList.remove('revealed');
            }
        }, REVEAL_MS);
        return true;
    }

    override render(): TemplateResult {
        return html`${this.segments().map((segment) => this.renderSegment(segment))}
            <div class="visually-hidden" role="status" aria-live="polite">${this.announcement}</div>`;
    }

    /** Consecutive items of one kind, each run under its group heading (if the kind has one). */
    private segments(): Segment[] {
        const segments: { heading: string | null; kind: OverlayKind; items: OverlayListItem[] }[] = [];
        for (const item of this.items) {
            const last = segments.at(-1);
            if (last?.kind === item.kind) {
                last.items.push(item);
            } else {
                segments.push({ heading: this.headingFor(item.kind), kind: item.kind, items: [item] });
            }
        }
        return segments;
    }

    private headingFor(kind: OverlayKind): string | null {
        return this.groups.find((group) => group.kind === kind)?.label ?? null;
    }

    private renderHeading(heading: string | null): TemplateResult | typeof nothing {
        return heading === null ? nothing : html`<h3>${heading}</h3>`;
    }

    private renderSegment(segment: Segment): TemplateResult {
        return html`${this.renderHeading(segment.heading)}
            <ul role="list">
                ${repeat(
                    segment.items,
                    (item) => item.id,
                    (item) => this.renderRow(item),
                )}
            </ul>`;
    }

    private renderRow(item: OverlayListItem): TemplateResult {
        const name = item.label;
        const percent = String(opacityPercent(item.opacity));
        const valueText = fillTemplate(this.valueText, { percent });
        return html`<li data-overlay=${item.id}>
            ${this.renderSwatch(item)} ${this.renderName(item)} ${this.renderSwitch(item)}
            <div class="opacity">
                <hcm-slider
                    min="0"
                    max="100"
                    step="1"
                    .value=${Number(percent)}
                    label=${fillTemplate(this.opacityLabel, { name })}
                    value-text=${valueText}
                    ?disabled=${this.disabled}
                    @hcm-input=${(event: Event) => {
                        this.onOpacity(item, valueOf(event), false);
                    }}
                    @hcm-change=${(event: Event) => {
                        this.onOpacity(item, valueOf(event), true);
                    }}
                ></hcm-slider>
                <span class="value body-medium" aria-hidden="true">${valueText}</span>
            </div>
        </li>`;
    }

    /** The name, with its date below when the row has one (a name that fits keeps the row's 48 px; a longer one wraps). */
    private renderName(item: OverlayListItem): TemplateResult {
        if (item.detail === undefined) {
            return html`<span class="name body-large">${item.label}</span>`;
        }
        return html`<span class="name dated"
            ><span class="label body-large">${item.label}</span><span class="detail">${item.detail}</span></span
        >`;
    }

    private renderSwitch(item: OverlayListItem): TemplateResult | typeof nothing {
        return item.toggleable === false
            ? nothing
            : html`<hcm-switch
                  .checked=${item.visible}
                  ?disabled=${this.disabled}
                  label=${fillTemplate(this.toggleLabel, { name: item.label })}
                  @hcm-change=${(event: Event) => {
                      this.onVisibility(item, checkedOf(event));
                  }}
              ></hcm-switch>`;
    }

    private renderSwatch(item: OverlayListItem): TemplateResult {
        const classes = item.color === undefined ? 'swatch' : 'swatch colored';
        return html`<span class=${classes} ${cssProperties({ '--swatch': item.color })} aria-hidden="true">
            <hcm-icon name=${item.icon ?? defaultIcon(item.kind)}></hcm-icon>
        </span>`;
    }

    private onVisibility(item: OverlayListItem, visible: boolean): void {
        emit(this, 'hcm-overlay-visibility', { id: item.id, visible });
        this.announcement = fillTemplate(visible ? this.shownText : this.hiddenText, { name: item.label });
    }

    private onOpacity(item: OverlayListItem, percent: number, final: boolean): void {
        emit(this, 'hcm-overlay-opacity', { id: item.id, opacity: percent / 100, final });
        if (final) {
            this.announcement = fillTemplate(this.changedText, { name: item.label, percent: String(percent) });
        }
    }
}

/** The swatch icon of an overlay without its own: a historical layer is a map, the photos a gallery, a POI a pin. */
function defaultIcon(kind: OverlayKind): string {
    const icons: Readonly<Record<OverlayKind, string>> = { raster: 'map', photos: 'photo_library', poi: 'location_on' };
    return icons[kind];
}

export function defineHcmOverlayList(registry: CustomElementRegistry = customElements): void {
    defineHcmIcon(registry);
    defineHcmSwitch(registry);
    defineHcmSlider(registry);
    defineOnce(registry, HCM_OVERLAY_LIST_TAG, HcmOverlayList);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-overlay-list': HcmOverlayList;
    }
}
