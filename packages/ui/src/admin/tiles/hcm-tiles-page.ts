/**
 * `<hcm-tiles-page>`: the tile-import wizard (`#/help/<versionId>/tiles`, `docs/research/M20-import-local.md` §19.11; behaviour
 * A-TILE-WIZARD). An archive series waiting with `layout-check`, in four steps: the sheets' order (`<hcm-tile-grid>`), the weak seams
 * (`<hcm-seam-pair>`), the preview and its quality meter (`<hcm-tile-preview>`), and the hand-off to the georeferencer. Back and Next
 * sit in a bar after the step (on a phone too: fixed over the step, it hid its last lines and buttons). Loading, a layout that cannot be read, a wrong address and a series that no
 * longer waits each say so. Text only: every value is bound as a property or text.
 */
import { translateApiError, type UiLocale } from '@hcm/shared';
import { css, html, type PropertyValues, type TemplateResult } from 'lit';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { trackAreaFunnels } from '../editing/area-funnel.js';
import { tilesText as t } from './tiles-text.js';
import { TILE_STEPS, type TilesIntentsPort, type TileStepPort, type TilesViewState } from './tiles-port.js';
import { tilesFunnel } from './tiles-funnel.js';

export const HCM_TILES_PAGE_TAG = 'hcm-tiles-page';

const STEP_KEYS = {
    order: 'adminTiles.step.order',
    seams: 'adminTiles.step.seams',
    preview: 'adminTiles.step.preview',
    points: 'adminTiles.step.points',
} as const;

/** What the page says while the wizard is not shown. */
const STATUS_KEYS = {
    loading: 'adminTiles.loading',
    ready: 'adminTiles.loading',
    notFound: 'adminTiles.notFound',
    moved: 'adminTiles.notWaiting',
} as const;

/** The step on screen (none: the wizard is not shown). */
function shownStep(view: TilesViewState | null): TileStepPort | null {
    return view !== null && view.status === 'ready' ? view.step : null;
}

function stepAt(step: TileStepPort, by: number): TileStepPort | undefined {
    return TILE_STEPS[TILE_STEPS.indexOf(step) + by];
}

class HcmTilesPage extends AreaPage<TilesViewState, TilesIntentsPort> {
    static override readonly fillsPage = false;

    static override readonly styles = [
        ...editingStyles,
        css`
            .pane {
                max-inline-size: 1200px;
            }

            ol.steps {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin: 0;
                padding: 0;
                list-style: none;
            }

            .bar {
                display: flex;
                flex-wrap: wrap;
                justify-content: space-between;
                gap: 8px;
                padding-block: 8px;
                background: var(--md-sys-color-surface, Canvas);
            }

            @media (width < 600px) {
                .bar {
                    border-block-start: 1px solid var(--md-sys-color-outline-variant, GrayText);
                }
            }

            a.link {
                display: inline-flex;
                align-items: center;
                min-block-size: 48px;
            }
        `,
    ];

    protected readonly route: AdminRouteIdPort = 'help';

    protected storeOf(content: ContentPort): AreaPort<TilesViewState, TilesIntentsPort> | null {
        return content.help;
    }

    /** The step shown last, so a new step moves the focus to its heading. */
    #shown: TileStepPort | null = null;

    protected override updated(changed: PropertyValues): void {
        // The wizard's funnel (§200): what changed since the last render, as codes.
        trackAreaFunnels(this, this.view, (view) => [tilesFunnel(view)]);
        super.updated(changed);
        const step = shownStep(this.view);
        if (step !== null && this.#shown !== null && step !== this.#shown) {
            this.renderRoot.querySelector<HTMLElement>('h2')?.focus();
        }
        this.#shown = step;
    }

    override render(): TemplateResult {
        const view = this.view;
        const locale = this.locale;
        if (view === null) {
            return html``;
        }
        return html`<div class="pane">${view.status === 'ready' ? this.#wizard(locale, view) : this.#state(locale, view)}</div>`;
    }

    #state(locale: UiLocale, view: TilesViewState): TemplateResult {
        if (view.status === 'error') {
            return html`<p class="alert" role="alert">${t(locale, 'adminTiles.loadFailed')}</p>
                <div class="actions">
                    <hcm-button
                        variant="tonal"
                        icon="refresh"
                        @click=${() => {
                            this.intents?.retry();
                        }}
                        >${t(locale, 'adminTiles.retry')}</hcm-button
                    >
                </div>`;
        }
        return html`<p class="note" role="status">${t(locale, STATUS_KEYS[view.status])}</p>
            ${view.status === 'moved' ? this.#georefLink(locale, view) : ''}`;
    }

    #georefLink(locale: UiLocale, view: TilesViewState): TemplateResult {
        return html`<a class="link" href=${['#/georef', view.versionId].join('/')}>${t(locale, 'adminTiles.openGeoref')}</a>`;
    }

    #wizard(locale: UiLocale, view: TilesViewState): TemplateResult {
        const n = String(TILE_STEPS.indexOf(view.step) + 1);
        return html`<p>${t(locale, 'adminTiles.intro')}</p>
            ${this.#steps(locale, view)}
            <h2 tabindex="-1">${t(locale, 'adminTiles.stepOf', { n, step: t(locale, STEP_KEYS[view.step]) })}</h2>
            ${this.#refusal(locale, view)} ${this.#step(locale, view)} ${this.#bar(locale, view)}`;
    }

    #steps(locale: UiLocale, view: TilesViewState): TemplateResult {
        return html`<nav aria-label=${t(locale, 'adminTiles.stepsLabel')}>
            <ol class="steps">
                ${TILE_STEPS.map(
                    (step) =>
                        html`<li>
                            <hcm-button
                                variant=${step === view.step ? 'tonal' : 'text'}
                                .current=${step === view.step}
                                ?disabled=${view.handedOff}
                                @click=${() => this.intents?.goTo(step)}
                                >${t(locale, STEP_KEYS[step])}</hcm-button
                            >
                        </li>`,
                )}
            </ol>
        </nav>`;
    }

    #refusal(locale: UiLocale, view: TilesViewState): TemplateResult {
        const refusal = view.refusal;
        return html`<p class="alert" role="alert" ?hidden=${refusal === null}>
            ${refusal === null ? '' : translateApiError(locale, refusal.key, refusal.params)}
        </p>`;
    }

    #step(locale: UiLocale, view: TilesViewState): TemplateResult {
        const intents = this.intents;
        switch (view.step) {
            case 'order':
                return html`<hcm-tile-grid .view=${view} .intents=${intents} locale=${locale}></hcm-tile-grid>`;
            case 'seams':
                return html`<hcm-seam-pair .view=${view} .intents=${intents} locale=${locale}></hcm-seam-pair>`;
            case 'preview':
                return html`<hcm-tile-preview .view=${view} .intents=${intents} locale=${locale}></hcm-tile-preview>`;
            case 'points':
                return this.#handOff(locale, view);
        }
    }

    #handOff(locale: UiLocale, view: TilesViewState): TemplateResult {
        if (view.handedOff) {
            return html`<p class="note" role="status">${t(locale, 'adminTiles.handedOff')}</p>
                ${this.#georefLink(locale, view)}`;
        }
        const none = view.sheets.every((sheet) => sheet.out !== null);
        return html`<p>${t(locale, 'adminTiles.handOffHelp')}</p>
            <p class="alert" role="alert" ?hidden=${!none}>${t(locale, 'adminTiles.allOut')}</p>
            <div class="actions">
                <hcm-button
                    variant="filled"
                    icon="add_location_alt"
                    ?disabled=${none || view.busy || this.readOnly}
                    @click=${() => this.intents?.handOff()}
                    >${t(locale, 'adminTiles.handOff')}</hcm-button
                >
            </div>`;
    }

    #bar(locale: UiLocale, view: TilesViewState): TemplateResult {
        const back = stepAt(view.step, -1);
        const next = stepAt(view.step, 1);
        const go = (step: TileStepPort | undefined): void => {
            if (step !== undefined) {
                this.intents?.goTo(step);
            }
        };
        return html`<div class="bar">
            <hcm-button
                variant="outlined"
                icon="arrow_back"
                ?disabled=${back === undefined || view.handedOff}
                @click=${() => {
                    go(back);
                }}
                >${t(locale, 'adminTiles.back')}</hcm-button
            >
            <hcm-button
                variant="tonal"
                icon="arrow_forward"
                ?disabled=${next === undefined}
                @click=${() => {
                    go(next);
                }}
                >${t(locale, 'adminTiles.next')}</hcm-button
            >
        </div>`;
    }
}

export function defineHcmTilesPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_TILES_PAGE_TAG) === undefined) {
        registry.define(HCM_TILES_PAGE_TAG, HcmTilesPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-tiles-page': HcmTilesPage;
    }
}
