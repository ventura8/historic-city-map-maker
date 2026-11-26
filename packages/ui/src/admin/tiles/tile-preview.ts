/**
 * `<hcm-tile-preview>`: step 3 of the tile-import wizard (`docs/research/M20-import-local.md` §19.11; S-A-HAPPY-TILE-WIZARD-PREVIEW,
 * S-A-BAD-TILE-WIZARD-PREVIEW-POOR). At once, the owner's layout drawn from the thumbnails; then, on request, the pipeline's real
 * preview (`imagery.saveLayout` with `preview`) and the quality meter: one `role="meter"` line per figure the verdict reads
 * (`placing/quality.py`), each saying in words whether it holds.
 */
import { STITCH_GOOD_PLACED_PCT, STITCH_GOOD_RMS_PX, STITCH_GOOD_SEAM_NCC, type UiLocale } from '@hcm/shared';
import type { AdminTilesKey } from '@hcm/shared/admin-tiles';
import { css, html, LitElement, type TemplateResult } from 'lit';

import { cssProperties } from '../../components/css-properties.js';
import { adminBase } from '../shell/admin-styles.js';
import { thumbProperties } from './tile-grid.js';
import { tilesText as t } from './tiles-text.js';
import { tileStyles } from './tiles-styles.js';
import type { TileQualityPort, TilesIntentsPort, TilesViewState } from './tiles-port.js';

const HCM_TILE_PREVIEW_TAG = 'hcm-tile-preview';

/** One line of the meter: its text, its value within its range, and whether it holds. */
interface MeterLine {
    readonly key: AdminTilesKey;
    readonly params: Readonly<Record<string, string>>;
    readonly value: number;
    readonly min: number;
    readonly max: number;
    readonly ok: boolean;
}

function meterLines(quality: TileQualityPort): readonly MeterLine[] {
    const { placedPct, seamMedian, seamRmsPx } = quality;
    return [
        {
            key: 'adminTiles.meter.placed',
            params: { pct: placedPct.toFixed(0) },
            value: placedPct,
            min: 0,
            max: 100,
            ok: placedPct >= STITCH_GOOD_PLACED_PCT,
        },
        {
            key: 'adminTiles.meter.seam',
            params: { score: seamMedian.toFixed(2) },
            value: seamMedian,
            min: -1,
            max: 1,
            ok: seamMedian >= STITCH_GOOD_SEAM_NCC,
        },
        {
            key: 'adminTiles.meter.rms',
            params: { px: seamRmsPx.toFixed(1) },
            value: seamRmsPx,
            min: 0,
            max: Math.max(STITCH_GOOD_RMS_PX * 4, seamRmsPx),
            ok: seamRmsPx <= STITCH_GOOD_RMS_PX,
        },
    ];
}

class HcmTilePreview extends LitElement {
    static override readonly properties = { view: { attribute: false }, intents: { attribute: false }, locale: { type: String } };

    static override readonly styles = [
        adminBase,
        tileStyles,
        css`
            :host {
                display: flex;
                flex-direction: column;
                gap: 16px;

                --hcm-tile-cell: 40px;
            }

            .mini {
                display: grid;
                grid-template-columns: repeat(var(--cols), var(--hcm-tile-cell));
                grid-auto-rows: var(--hcm-tile-cell);
                max-inline-size: 100%;
                overflow: auto;
            }

            .mini span.cell {
                display: grid;
                place-items: center;
                grid-row: var(--row);
                grid-column: var(--col);
            }

            img {
                max-inline-size: 100%;
                block-size: auto;
            }

            .line {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .bar {
                block-size: 8px;
                border-radius: 4px;
                background: var(--md-sys-color-surface-container-highest, GrayText);
            }

            .bar span {
                display: block;
                inline-size: var(--share);
                block-size: 100%;
                border-radius: 4px;
                background: var(--md-sys-color-error, Mark);
            }

            .bar.ok span {
                background: var(--md-sys-color-primary, Highlight);
            }
        `,
    ];

    declare view: TilesViewState | null;
    declare intents: TilesIntentsPort | null;
    declare locale: UiLocale;

    constructor() {
        super();
        this.view = null;
        this.intents = null;
        this.locale = 'ro';
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return html``;
        }
        return html`<h3>${t(this.locale, 'adminTiles.instant')}</h3>
            ${this.#instant(view)} ${this.#real(view)} ${view.quality === null ? '' : this.#meter(view.quality)}`;
    }

    #instant(view: TilesViewState): TemplateResult {
        const placed = view.sheets.filter((sheet) => sheet.out === null);
        return html`<div
            class="mini"
            role="img"
            aria-label=${t(this.locale, 'adminTiles.instant')}
            ${cssProperties({ '--cols': String(view.cols) })}
        >
            ${placed.map(
                (sheet) =>
                    html`<span class="cell" ${cssProperties({ '--row': String(sheet.row + 1), '--col': String(sheet.col + 1) })}
                        ><span class="thumb" ${cssProperties(thumbProperties(sheet, view.thumbs))}></span
                    ></span>`,
            )}
        </div>`;
    }

    #real(view: TilesViewState): TemplateResult {
        const none = view.sheets.every((sheet) => sheet.out !== null);
        return html`<div class="actions">
                <hcm-button
                    variant="tonal"
                    icon="visibility"
                    ?disabled=${none || view.busy || view.previewing}
                    @click=${() => this.intents?.preview()}
                    >${t(this.locale, 'adminTiles.makePreview')}</hcm-button
                >
            </div>
            <p class="note" role="status">${view.previewing ? t(this.locale, 'adminTiles.previewing') : ''}</p>
            ${this.#stitched(view)}`;
    }

    #stitched(view: TilesViewState): TemplateResult | string {
        return view.stitched === null || view.previewing
            ? ''
            : html`<figure>
                  <img src=${view.stitched} alt=${t(this.locale, 'adminTiles.stitched')} />
              </figure>`;
    }

    #meter(quality: TileQualityPort): TemplateResult {
        const verdict = t(this.locale, `adminTiles.verdict.${quality.verdict}`);
        return html`<section aria-labelledby="meter-title" class="meter">
            <h3 id="meter-title">${t(this.locale, 'adminTiles.meterLabel')}</h3>
            <p>${t(this.locale, 'adminTiles.verdictIs', { verdict })}</p>
            ${meterLines(quality).map((line) => this.#line(line))}
            ${quality.verdict === 'poor' ? html`<p class="alert" role="alert">${t(this.locale, 'adminTiles.poor')}</p>` : ''}
        </section>`;
    }

    #line(line: MeterLine): TemplateResult {
        const text = `${t(this.locale, line.key, line.params)}: ${t(this.locale, line.ok ? 'adminTiles.meter.ok' : 'adminTiles.meter.needs')}`;
        const share = `${String(Math.round(((line.value - line.min) / (line.max - line.min)) * 100))}%`;
        return html`<div class="line">
            <span>${text}</span>
            <div
                class="bar ${line.ok ? 'ok' : ''}"
                role="meter"
                aria-label=${t(this.locale, line.key, line.params)}
                aria-valuemin=${line.min}
                aria-valuemax=${line.max}
                aria-valuenow=${line.value}
                aria-valuetext=${text}
            >
                <span ${cssProperties({ '--share': share })}></span>
            </div>
        </div>`;
    }
}

export function defineHcmTilePreview(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_TILE_PREVIEW_TAG) === undefined) {
        registry.define(HCM_TILE_PREVIEW_TAG, HcmTilePreview);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-tile-preview': HcmTilePreview;
    }
}
