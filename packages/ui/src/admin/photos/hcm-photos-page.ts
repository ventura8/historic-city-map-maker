/**
 * `<hcm-photos-page>`: `#/photos` and `#/photos/<photoId>` (`docs/research/M2c-interfaces.md` §1.2, §6; behaviours A08,
 * A09, A10, A37). The list pane (`hcm-admin-photo-list`: uploads, filters, search, bulk actions, rows) beside, or instead of,
 * the detail pane: the page's one map (every loaded photo, the open one from its draft) above the open photo's editor
 * (`hcm-admin-photo-editor`), or, with no photo open on a wide window, the map with a hint. The map is created the first time
 * its pane shows and destroyed when the page goes (every map load is billed, §3.5), in the admin map's box (`hcm-admin-map`:
 * mapbox-gl.css inside its shadow root for Mapbox's logo and attribution, the kit's zoom buttons, the keyboard's crosshair,
 * CR-M2c-22); without it (no factory, no token, no WebGL) the box says why and every field still works. The delete
 * confirmation, the skipped photos of a bulk action and Author, source and licence are this page's dialogs.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type PropertyValues, type TemplateResult } from 'lit';

import { WindowClassController } from '../../layout/window-class.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { splitsAt } from '../editing/hcm-list-detail.js';
import { EMPTY } from '../shell/empty.js';
import { deleteDialog, reportDialog, setFieldsDialog } from './photo-dialogs.js';
import { photoStyles } from './photo-styles.js';
import { photoText } from './photo-text.js';
import type { MapStatusPort, PhotosIntentsPort, PhotosViewState, StickyPort } from './photos-port.js';

export const HCM_PHOTOS_PAGE_TAG = 'hcm-photos-page';

/** Window classes where the list and the detail show side by side (the map then shows without an open photo). */

export class HcmPhotosPage extends AreaPage<PhotosViewState, PhotosIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, settingFields: { state: true } };

    static override readonly styles = photoStyles;

    protected readonly route: AdminRouteIdPort = 'photos';
    /** The Author, source and licence dialog is open (for this many photos). */
    declare settingFields: { readonly count: number } | null;
    readonly #size = new WindowClassController(this);
    /** The admin map box's drawing element, once it rendered (`hcm-map-host`). */
    #container: HTMLElement | null = null;
    /** The element the area's map was created in (one per page visit). */
    #mapHost: HTMLElement | null = null;

    constructor() {
        super();
        this.settingFields = null;
    }

    protected storeOf(content: ContentPort): AreaPort<PhotosViewState, PhotosIntentsPort> | null {
        return content.photos;
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#container = null;
        this.#mapHost = null;
    }

    /** The map's pane shows: side by side, or a photo is open. */
    get mapVisible(): boolean {
        return splitsAt(this.#size.size) || this.params.length > 0;
    }

    protected override updated(changed: PropertyValues<this>): void {
        super.updated(changed);
        this.#attachMap();
    }

    /** Creates the map in the box's drawing element once the box rendered and its pane shows (once per page visit). */
    #attachMap(): void {
        const host = this.#container;
        const intents = this.intents;
        if (host === null || intents === null || !this.mapVisible || host === this.#mapHost) {
            return;
        }
        this.#mapHost = host;
        intents.attachMap(host, (photoId) => {
            this.go([photoId]);
        });
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const open = this.params[0] ?? '';
        return html`<hcm-list-detail
                ?detail=${open !== ''}
                .detailKey=${open}
                .listLabel=${photoText(locale, 'adminContent.photos.list')}
                .detailLabel=${photoText(locale, 'adminContent.photos.map.label')}
                .backLabel=${photoText(locale, 'adminContent.photos.editor.back')}
                .closeLabel=${photoText(locale, 'adminContent.photos.editor.close')}
                @hcm-back=${() => {
                    this.go([]);
                }}
            >
                <hcm-admin-photo-list
                    slot="list"
                    .view=${view}
                    .intents=${this.intents}
                    .locale=${locale}
                    .selected=${open}
                    ?read-only=${this.readOnly}
                    @hcm-set-fields=${() => {
                        this.settingFields = { count: view.list.selection.length };
                    }}
                ></hcm-admin-photo-list>
                <div slot="detail" class="detail">${this.#map(locale, view.map)} ${this.#detail(locale, view, open)}</div>
            </hcm-list-detail>
            ${this.#dialogs(locale, view)}`;
    }

    #map(locale: UiLocale, status: MapStatusPort): TemplateResult {
        // The detail pane is the region named after the map (`hcm-list-detail`'s detailLabel): the box itself is not another.
        return html`<hcm-admin-map
            class="map"
            .status=${status}
            .locale=${locale}
            @hcm-map-host=${(event: CustomEvent<{ readonly container: HTMLElement }>) => {
                this.#container = event.detail.container;
                this.#attachMap();
            }}
            @hcm-zoom=${(event: CustomEvent<{ readonly delta: number }>) => this.intents?.zoomBy(event.detail.delta)}
        ></hcm-admin-map>`;
    }

    #detail(locale: UiLocale, view: PhotosViewState, open: string): TemplateResult {
        if (open === '' || view.editor === null) {
            return html`<hcm-empty-state
                icon="photo_library"
                .text=${photoText(locale, 'adminContent.photos.overview')}
            ></hcm-empty-state>`;
        }
        return html`<hcm-admin-photo-editor
            data-detail-heading
            .editor=${view.editor}
            .assist=${view.assist}
            .intents=${this.intents}
            .locale=${locale}
            ?map-ready=${view.map === 'ready'}
            ?read-only=${this.readOnly}
            .who=${{ self: this.self, people: this.people }}
            @hcm-history=${() => {
                this.app?.intents.navigate({ id: 'history', params: ['photo', open] });
            }}
        ></hcm-admin-photo-editor>`;
    }

    /** Deletes what the confirmation names; the open photo deleted, the page goes back to the list. */
    async #confirmDelete(ids: readonly string[]): Promise<void> {
        const open = this.params[0] ?? '';
        const deleted = (await this.intents?.confirmDelete()) === true;
        if (deleted && ids.includes(open)) {
            this.go([]);
        }
    }

    #dialogs(locale: UiLocale, view: PhotosViewState): TemplateResult {
        const intents = this.intents;
        const apply = (fields: StickyPort): void => {
            this.settingFields = null;
            void intents?.bulk({ kind: 'setFields', fields });
        };
        return html`${deleteDialog(locale, view.confirm, { confirm: () => void this.#confirmDelete(view.confirm?.ids ?? []), cancel: () => intents?.cancelConfirm() })}
        ${reportDialog(locale, view.report, () => intents?.closeReport())}
        ${setFieldsDialog(locale, this.settingFields, {
            apply,
            close: () => {
                this.settingFields = null;
            },
        })}`;
    }
}

/** Registers `<hcm-photos-page>` once; calling it again is a no-op. */
export function defineHcmPhotosPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_PHOTOS_PAGE_TAG) === undefined) {
        registry.define(HCM_PHOTOS_PAGE_TAG, HcmPhotosPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-photos-page': HcmPhotosPage;
    }
}
