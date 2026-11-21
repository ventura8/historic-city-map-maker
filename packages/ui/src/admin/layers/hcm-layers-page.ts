/**
 * `<hcm-layers-page>`: `#/layers` and `#/layers/<layerId>` (`docs/research/M2c-interfaces.md` §8.1–§8.4; behaviours
 * A15, A33, A35, A36). The city's historical layers top first, reordered by a drag or Move up and Move down, with
 * **Link a layer**; the open layer's editor beside the list from 840 px, in its place below. Every slider previews live
 * on the page's map once one is attached (`attachPreview`); nothing is written before Save.
 */
import type { UiLocale } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';

import { MAPBOX_GL_CSS_URL } from '../../map/mapbox-loader.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import { assistStyles } from '../assist/assist-parts.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { listBody, reconnectingStatus } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { keepFocus } from './focus-keeper.js';
import { announcer } from './form-parts.js';
import { layerEditor } from './layer-editor.js';
import { labelOf, type LayerItemPort, type LayersIntentsPort, type LayersViewState } from './layers-port.js';
import { layersStyles } from './layers-styles.js';
import { linkDialog } from './link-dialog.js';
import { reorderList, RowDrag } from './reorder.js';

export const HCM_LAYERS_PAGE_TAG = 'hcm-layers-page';

export class HcmLayersPage extends AreaPage<LayersViewState, LayersIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, announcement: { state: true }, mapCss: { attribute: false } };

    /** M18 item 6: the link to the place categories is a 48 px target in its sentence (the Layers page's own: not shared). */
    static override readonly styles = [
        ...layersStyles,
        ...assistStyles,
        css`
            .places a {
                display: inline-flex;
                align-items: center;
                min-block-size: 48px;
            }
        `,
    ];

    protected readonly route: AdminRouteIdPort = 'layers';
    /** The last settled change, said in the page's polite region. */
    declare announcement: string;
    /** mapbox-gl.css of the pinned release for the page's map ('' in tests: no network). */
    declare mapCss: string;
    readonly #drag = new RowDrag((id, index) => {
        void this.intents?.moveTo(id, index);
    });

    constructor() {
        super();
        this.announcement = '';
        this.mapCss = MAPBOX_GL_CSS_URL;
        keepFocus(this);
    }

    protected storeOf(content: ContentPort): AreaPort<LayersViewState, LayersIntentsPort> | null {
        return content.layers;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const editor = view.editor;
        return html`<hcm-list-detail
                ?detail=${editor !== null}
                .detailKey=${editor?.id ?? ''}
                .listLabel=${contentText(locale, 'adminContent.layers.listLabel')}
                .detailLabel=${contentText(locale, 'adminContent.layers.detailLabel')}
                .backLabel=${contentText(locale, 'adminContent.common.back')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-back=${() => {
                    this.go([]);
                }}
            >
                <div slot="list">${this.#list(locale, view)}</div>
                <div slot="detail">${this.#detail(locale, view)}</div>
            </hcm-list-detail>
            ${linkDialog(locale, view.link, this.intents, (id) => {
                this.go([id]);
            })}
            ${announcer(this.announcement)}`;
    }

    /** M18 item 6: the head points to the place categories, which are the viewer's Places group (edited in Settings). */
    #list(locale: UiLocale, view: LayersViewState): TemplateResult {
        const intents = this.intents;
        return html`<div class="list-head">
                <h2>${contentText(locale, 'adminContent.layers.title')}</h2>
                <p class="note">${contentText(locale, 'adminContent.layers.dragHint')}</p>
                <p class="note places">
                    ${contentText(locale, 'adminContent.layers.placesNote')}
                    <a href="#/settings/categories">${contentText(locale, 'adminContent.layers.placesLink')}</a>
                </p>
                <div class="actions">
                    <hcm-button variant="tonal" icon="link" ?disabled=${this.readOnly} @click=${() => intents?.openLink()}
                        >${contentText(locale, 'adminContent.layers.link')}</hcm-button
                    >
                </div>
                ${reconnectingStatus(locale, view.list.reconnecting || view.reordering)}
            </div>
            ${listBody(
                locale,
                view.list,
                { empty: 'adminContent.layers.empty', icon: 'layers' },
                {
                    retry: () => intents?.retry(),
                    more: () => undefined,
                    items: (items) => this.#rows(locale, view, items),
                },
            )}`;
    }

    #rows(locale: UiLocale, view: LayersViewState, items: readonly LayerItemPort[]): TemplateResult {
        const topFirst = items.toSorted((a, b) => b.order - a.order || b.year - a.year || a.id.localeCompare(b.id));
        const rows = topFirst.map((layer) => ({
            id: layer.id,
            title: labelOf(layer.label, locale),
            detail: this.#detailOf(locale, layer),
            href: this.href([layer.id]),
            selected: layer.id === view.editor?.id,
        }));
        const labels = {
            up: (name: string) => contentText(locale, 'adminContent.layers.moveUp', { name }),
            down: (name: string) => contentText(locale, 'adminContent.layers.moveDown', { name }),
            list: contentText(locale, 'adminContent.layers.listLabel'),
        };
        const handlers = {
            move: (id: string, direction: 'up' | 'down') => {
                void this.intents?.move(id, direction);
            },
            readOnly: this.readOnly,
        };
        return reorderList(rows, labels, handlers, this.#drag);
    }

    #detailOf(locale: UiLocale, layer: LayerItemPort): string {
        const status = contentText(locale, `adminContent.layers.status.${layer.status}`);
        const published = contentText(locale, layer.published ? 'adminContent.layers.published' : 'adminContent.layers.unpublished');
        const linked = layer.linked ? ` · ${contentText(locale, 'adminContent.layers.linkedTag')}` : '';
        return `${contentText(locale, 'adminContent.layers.rowDetail', { year: String(layer.year), status })} · ${published}${linked}`;
    }

    #detail(locale: UiLocale, view: LayersViewState): TemplateResult {
        const editor = view.editor;
        if (editor === null) {
            return html`<hcm-empty-state icon="layers" .text=${contentText(locale, 'adminContent.layers.choose')}></hcm-empty-state>`;
        }
        const context = {
            locale,
            intents: this.intents,
            listHref: this.href([]),
            announce: (text: string) => {
                this.announcement = text;
            },
            deleted: () => {
                this.go([]);
            },
            map: { status: view.map, css: this.mapCss },
            readOnly: this.readOnly,
            who: { self: this.self, people: this.people },
            crop: view.crop,
            assist: view.assist,
        };
        return layerEditor(context, editor, view.deletion);
    }
}

/** Registers `<hcm-layers-page>` (its kit elements are the editing kit's, `defineEditingElements`). */
export function defineHcmLayersPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_LAYERS_PAGE_TAG) === undefined) {
        registry.define(HCM_LAYERS_PAGE_TAG, HcmLayersPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-layers-page': HcmLayersPage;
    }
}
