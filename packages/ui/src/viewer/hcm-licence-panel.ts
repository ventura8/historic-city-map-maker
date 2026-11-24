/**
 * `<hcm-licence-panel>` (V92): the body of About's Licence and citation mode, side-loaded with About (`extras-part.ts`).
 * It states the licence of the map's own work, of every layer (with its download, or why there is none) and of the
 * photos, and offers the citation of the current view and of each layer, copied with one press; when the clipboard
 * refuses, the citation shows as text to select by hand. Rules: `licence.ts`.
 */
import { DEFAULT_LOCALE, LICENSE_URLS, localized, translate, type Layer, type Manifest, type ViewerLocale } from '@hcm/shared';
import { localizedCredit } from '@hcm/shared/credits';
import { LitElement, css, html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import { accessDate, citation, isPublicDomainLayer, layerDownload, layerLink, licenceCounts } from './licence.js';
import { baseStyles, detailStyles } from './shared-styles.js';
import { licenseText, photoCountText } from './text.js';

export const HCM_LICENCE_PANEL_TAG = 'hcm-licence-panel';

/** The last copy: which citation (`view` or a layer's id), whether the clipboard took it, and its text. */
interface CopyStatus {
    readonly id: string;
    readonly ok: boolean;
    readonly text: string;
}

export class HcmLicencePanel extends LitElement {
    static override readonly properties = {
        manifest: { attribute: false },
        manifestUrl: { attribute: false },
        locale: { type: String },
        href: { attribute: false },
        now: { attribute: false },
        status: { state: true },
    };

    static override readonly styles = [
        baseStyles,
        detailStyles,
        css`
            :host {
                display: block;
                max-inline-size: 60ch;
            }

            textarea {
                box-sizing: border-box;
                inline-size: 100%;
                min-block-size: 6lh;
                padding: 8px;
                border: 1px solid var(--md-sys-color-outline);
                border-radius: var(--md-sys-shape-corner-small);
                background: var(--md-sys-color-surface-container-highest);
                color: var(--md-sys-color-on-surface);
                font: inherit;
                resize: vertical;
            }

            ul.layers > li {
                padding-block: 8px;
                border-block-end: 1px solid var(--md-sys-color-outline-variant);
            }

            .actions {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
            }

            .actions a {
                display: inline-flex;
                align-items: center;
                min-block-size: 48px;
            }
        `,
    ];

    declare manifest: Manifest | null;
    declare manifestUrl: string;
    declare locale: ViewerLocale;
    /** The page's address (the view a citation links to); the panel reads `location.href` when it is empty. */
    declare href: string;
    /** The day a citation says the map was seen; the tests set it, the page uses the clock. */
    declare now: Date | null;
    declare status: CopyStatus | null;

    constructor() {
        super();
        this.manifest = null;
        this.manifestUrl = '';
        this.locale = DEFAULT_LOCALE;
        this.href = '';
        this.now = null;
        this.status = null;
    }

    override render(): TemplateResult {
        const manifest = this.manifest;
        if (manifest === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const layers = [...manifest.layers].sort((a, b) => a.year - b.year);
        const viewText = this.#cite(localized(manifest.city.name, locale), translate(locale, 'cite.mapKind'), this.#href());
        return html`<section>
                <h3>${translate(locale, 'licence.ours.title')}</h3>
                <p>${translate(locale, 'licence.oursUsgs')}</p>
                <p>${translate(locale, 'licence.oursScans')}</p>
                <p>${translate(locale, 'licence.oursTexts')}</p>
            </section>
            <section>
                <h3>${translate(locale, 'cite.view')}</h3>
                <textarea readonly aria-label=${translate(locale, 'cite.view')} data-cite-text="view" .value=${viewText}></textarea>
                <div class="actions">${this.#copyButton('view', viewText)}</div>
                ${this.#statusLine('view')}
            </section>
            <section>
                <h3>${translate(locale, 'licence.layers')}</h3>
                <ul class="layers">
                    ${layers.map((layer) => this.#layer(layer, manifest))}
                </ul>
            </section>
            ${this.#photos(manifest)}`;
    }

    #href(): string {
        return this.href === '' ? globalThis.location.href : this.href;
    }

    #cite(title: string, map: string, url: string): string {
        return citation({ title, map, url, date: accessDate(this.now ?? new Date(), this.locale) }, this.locale);
    }

    #layer(layer: Layer, manifest: Manifest): TemplateResult {
        const locale = this.locale;
        const title = `${localized(layer.label, locale)} (${String(layer.year)})`;
        const text = this.#cite(title, localized(manifest.city.name, locale), layerLink(this.#href(), layer.id));
        const rights = translate(locale, isPublicDomainLayer(layer) ? 'licence.layerPd' : 'licence.layerSource');
        return html`<li data-layer=${layer.id}>
            <strong>${title}</strong>
            <p class="supporting">${localizedCredit(layer.attribution, locale)}</p>
            <p>${rights}</p>
            <div class="actions">${this.#copyButton(layer.id, text)} ${this.#download(layer)}</div>
            ${this.#statusLine(layer.id)}
        </li>`;
    }

    #download(layer: Layer): TemplateResult {
        const locale = this.locale;
        const download = layerDownload(layer, this.manifestUrl, document.baseURI);
        if (download.kind === 'pmtiles') {
            return html`<a href=${download.url} download data-download="pmtiles">${translate(locale, 'licence.downloadPmtiles')}</a>
                <span class="supporting">${translate(locale, 'licence.geotiffPlanned')}</span>`;
        }
        const key = download.kind === 'planned' ? 'licence.downloadPlanned' : 'licence.noDownload';
        return html`<span class="supporting" data-download=${download.kind}>${translate(locale, key)}</span>`;
    }

    #copyButton(id: string, text: string): TemplateResult {
        const copy = (): void => {
            void this.#copy(id, text);
        };
        return html`<hcm-button variant="outlined" icon="content_copy" data-cite=${id} @click=${copy}
            >${translate(this.locale, 'cite.copy')}</hcm-button
        >`;
    }

    async #copy(id: string, text: string): Promise<void> {
        try {
            await globalThis.navigator.clipboard.writeText(text);
            this.status = { id, ok: true, text };
        } catch {
            this.status = { id, ok: false, text };
        }
    }

    #statusLine(id: string): TemplateResult {
        const status = this.status;
        if (status?.id !== id) {
            return EMPTY;
        }
        if (status.ok) {
            return html`<p role="status" data-cite-status="copied">${translate(this.locale, 'cite.copied')}</p>`;
        }
        return html`<p role="status" data-cite-status="failed">${translate(this.locale, 'cite.copyFailed')}</p>
            <p class="supporting" data-cite-fallback>${status.text}</p>`;
    }

    #photos(manifest: Manifest): TemplateResult {
        const counts = licenceCounts([...manifest.photos, ...(manifest.unplaced ?? [])]);
        if (counts.length === 0) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<section>
            <h3>${translate(locale, 'licence.photos')}</h3>
            <p>${translate(locale, 'licence.photosNote')}</p>
            <ul>
                ${counts.map(([license, count]) => {
                    const url = LICENSE_URLS[license];
                    const name =
                        url === undefined
                            ? licenseText(license, locale)
                            : html`<a href=${url} target="_blank" rel="license noopener">${licenseText(license, locale)}</a>`;
                    return html`<li data-licence=${license}>${name}: ${photoCountText(count, locale)}</li>`;
                })}
            </ul>
        </section>`;
    }
}

export function defineHcmLicencePanel(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_LICENCE_PANEL_TAG) === undefined) {
        registry.define(HCM_LICENCE_PANEL_TAG, HcmLicencePanel);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-licence-panel': HcmLicencePanel;
    }
}
