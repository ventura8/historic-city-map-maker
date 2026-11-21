/**
 * `<hcm-settings-page>`: `#/settings`, `#/settings/<section>` and `#/settings/categories/<id>`
 * (`docs/research/M2c-interfaces.md` §8.5; behaviours A19, A36, A39). The sections in the list pane; the open one in the
 * detail pane (in its place below 840 px), each its own draft with its own Save. While the theme section previews a
 * seed, the whole admin wears the previewed schemes: the settings store hands them to the shell (CR-M2c-28), and
 * Discard, Save, leaving Settings or signing out takes them off. The area and overlays sections show the page's one map
 * at the top of the detail (`DECISIONS-for-review.md` §42a): the city's content as the visitors see it, the bounds as a
 * rectangle, the overlay defaults previewed live; the same map element for both, so moving between them loads no other.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { MAPBOX_GL_CSS_URL } from '../../map/mapbox-loader.js';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { current, errorTemplate, loadingTemplate, reconnectingStatus } from '../editing/states.js';
import { keepFocus } from '../layers/focus-keeper.js';
import { announcer } from '../layers/form-parts.js';
import { layersStyles } from '../layers/layers-styles.js';
import { RowDrag } from '../layers/reorder.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { areaSection } from './area-section.js';
import { lazyIconCard } from './lazy-icon.js';
import { imagerySection } from './imagery-section.js';
import { categoriesSection } from './categories-section.js';
import { lazyBudgetCard } from '../cities/lazy-budget.js';
import { publicAddressStyles } from '../cities/public-address.js';
import { lazyExportCard } from '../export/lazy-card.js';
import { overlaysSection } from './overlays-section.js';
import { publishSection } from './publish-section.js';
import { sectionRowTexts, type SectionContext } from './section-parts.js';
import type { SettingsIntentsPort, SettingsSectionPort, SettingsViewState } from './settings-port.js';
import { settingsStyles } from './settings-styles.js';
import { textsSection } from './texts-section.js';
import { themeSection } from './theme-section.js';

export const HCM_SETTINGS_PAGE_TAG = 'hcm-settings-page';

const SECTIONS: readonly SettingsSectionPort[] = [
    'area',
    'texts',
    'theme',
    'icon',
    'imagery',
    'categories',
    'overlays',
    'publish',
    'budget',
    'export',
];

/** The sections that show the page's map. */
const MAP_SECTIONS: ReadonlySet<SettingsSectionPort> = new Set<SettingsSectionPort>(['area', 'overlays']);

const SECTION_ICONS: Readonly<Record<SettingsSectionPort, string>> = {
    area: 'crop_free',
    texts: 'translate',
    theme: 'palette',
    icon: 'map',
    imagery: 'satellite_alt',
    categories: 'place',
    overlays: 'opacity',
    publish: 'publish',
    export: 'download',
    budget: 'tune',
};

const RENDERERS: Readonly<Record<Exclude<SettingsSectionPort, 'categories'>, (context: SectionContext) => TemplateResult>> = {
    area: areaSection,
    texts: textsSection,
    theme: themeSection,
    // The public map's browser tab icon (docs/research/M2-interfaces.md → The city's tab icon): a chunk of its own.
    icon: lazyIconCard,
    imagery: imagerySection,
    overlays: overlaysSection,
    // M5 (the integrator, DECISIONS-for-review.md §63a): whether visitors see the city.
    publish: publishSection,
    // M5 (CR-M5-10; owner: export): the card is a chunk of its own, fetched when the section first opens.
    export: (context) => lazyExportCard({ ...context, view: context.view.export }),
    // M5 (owner: multi-city): the city's budget, a chunk of its own too.
    budget: (context) => lazyBudgetCard({ ...context, view: context.view.budget }),
};

export class HcmSettingsPage extends AreaPage<SettingsViewState, SettingsIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, announcement: { state: true }, mapCss: { attribute: false } };

    static override readonly styles = [...layersStyles, settingsStyles, publicAddressStyles];

    protected readonly route: AdminRouteIdPort = 'settings';
    declare announcement: string;
    /** mapbox-gl.css's address for the map's shadow root ('' in tests: no network). */
    declare mapCss: string;
    readonly #drag = new RowDrag((id, index) => {
        void this.intents?.moveCategoryTo(id, index);
    });

    constructor() {
        super();
        this.announcement = '';
        this.mapCss = MAPBOX_GL_CSS_URL;
        keepFocus(this);
    }

    protected storeOf(content: ContentPort): AreaPort<SettingsViewState, SettingsIntentsPort> | null {
        return content.settings;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<hcm-list-detail
                ?detail=${view.section !== null}
                .detailKey=${[view.section ?? '', view.category?.id ?? ''].join('/').replace(/\/$/, '')}
                .listLabel=${contentText(locale, 'adminContent.settings.listLabel')}
                .detailLabel=${contentText(locale, 'adminContent.settings.detailLabel')}
                .backLabel=${contentText(locale, 'adminContent.common.back')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-back=${() => {
                    this.go(view.category === null ? [] : ['categories']);
                }}
            >
                <div slot="list">${this.#sections(locale, view)}</div>
                <div slot="detail">${this.#detail(locale, view)}</div>
            </hcm-list-detail>
            ${announcer(this.announcement)}`;
    }

    #sections(locale: UiLocale, view: SettingsViewState): TemplateResult {
        return html`<div class="list-head">
                <h2>${contentText(locale, 'adminContent.settings.title')}</h2>
                ${reconnectingStatus(locale, view.city.reconnecting)}
            </div>
            <ul class="rows" aria-label=${contentText(locale, 'adminContent.settings.sections')}>
                ${SECTIONS.map(
                    (section) =>
                        html`<li>
                            <a class="row section-row" href=${this.href([section])} aria-current=${current(section === view.section)}>
                                <hcm-icon name=${SECTION_ICONS[section]}></hcm-icon>
                                <span class="row-text">
                                    <span class="row-title">${sectionRowTexts(locale, section).title}</span>
                                    <span class="row-detail">${sectionRowTexts(locale, section).hint}</span>
                                </span>
                            </a>
                        </li>`,
                )}
                <li>${this.#sourcesRow(locale)}</li>
            </ul>`;
    }

    /** M28: the map's sources are chosen in Setup's Sources step; the row goes there (Setup stays open after it is done). */
    #sourcesRow(locale: UiLocale): TemplateResult {
        return html`<a class="row section-row" href="#/setup/sources" data-settings-sources>
            <hcm-icon name="travel_explore"></hcm-icon>
            <span class="row-text">
                <span class="row-title">${contentText(locale, 'adminContent.settings.section.sources')}</span>
                <span class="row-detail">${contentText(locale, 'adminContent.settings.section.sourcesHint')}</span>
            </span>
        </a>`;
    }

    #detail(locale: UiLocale, view: SettingsViewState): TemplateResult {
        const section = view.section;
        if (section === null) {
            return html`<hcm-empty-state icon="settings" .text=${contentText(locale, 'adminContent.settings.choose')}></hcm-empty-state>`;
        }
        if (view.city.status === 'error') {
            return errorTemplate(locale, view.city.failure, () => this.intents?.retry());
        }
        if (view.city.status === 'loading') {
            return loadingTemplate(locale);
        }
        return html`<div class="pane">${this.#mapBox(locale, view, section)} ${this.#section(locale, view, section)}</div>`;
    }

    /** The page's map, for the area and overlays sections of a city that exists. */
    #mapBox(locale: UiLocale, view: SettingsViewState, section: SettingsSectionPort): TemplateResult {
        if (!MAP_SECTIONS.has(section) || view.city.doc === null) {
            return EMPTY;
        }
        return html`<hcm-admin-map
            class="settings-map"
            .status=${view.map.status}
            .locale=${locale}
            .cssUrl=${this.mapCss}
            @hcm-map-host=${(event: Event) => {
                this.intents?.attachMap((event as CustomEvent<{ readonly container: HTMLElement }>).detail.container);
            }}
            @hcm-zoom=${(event: Event) => {
                this.intents?.zoomBy((event as CustomEvent<{ readonly delta: number }>).detail.delta);
            }}
        ></hcm-admin-map>`;
    }

    /** The city the shell has open (its public address in Publishing), null before the shell knows it. */
    #cityId(): string | null {
        return this.state?.cityId ?? null;
    }

    #section(locale: UiLocale, view: SettingsViewState, section: SettingsSectionPort): TemplateResult {
        if (view.city.doc === null && section !== 'categories' && section !== 'overlays') {
            return html`<h2 tabindex="-1" data-detail-heading>${sectionRowTexts(locale, section).title}</h2>
                <p class="alert" role="alert"><span>${contentText(locale, 'adminContent.settings.cityMissing')}</span></p>`;
        }
        const context: SectionContext = {
            ...{ locale, view, intents: this.intents },
            href: (params) => this.href(params),
            go: (params) => {
                this.go(params);
            },
            announce: (text) => {
                this.announcement = text;
            },
            readOnly: this.readOnly,
            who: { self: this.self, people: this.people },
            refresh: () => {
                this.requestUpdate();
            },
            cityId: this.#cityId(),
        };
        return section === 'categories' ? categoriesSection(context, this.#drag) : RENDERERS[section](context);
    }
}

/** Registers `<hcm-settings-page>` and the icon picker it renders. */
export function defineHcmSettingsPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_SETTINGS_PAGE_TAG) === undefined) {
        registry.define(HCM_SETTINGS_PAGE_TAG, HcmSettingsPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-settings-page': HcmSettingsPage;
    }
}
