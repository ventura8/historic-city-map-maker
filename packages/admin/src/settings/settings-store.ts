/**
 * The settings area's store (`./settings.ts` holds its state and intents): the city document, the layers and the POI
 * categories as live listeners, and one controller per kind of section, each with its own draft. Only the open section
 * holds edits; the shell's unsaved guard asks before a route change discards them.
 */
import {
    FIRESTORE_PATHS,
    MAX_LAYERS,
    MAX_POI_CATEGORIES,
    cityDocSchema,
    layerDocSchema,
    poiCategoryDocSchema,
    type CityDoc,
    type LayerDoc,
    type PoiCategoryDoc,
} from '@hcm/shared';
import type { AreaStore } from '../content/areas.js';
import { LiveDoc, LOADING_DOC, type DocState } from '../content/doc.js';
import { LiveList, LOADING_LIST } from '../content/list.js';
import { BudgetSection, NO_BUDGET_SECTION, type BudgetSectionState } from '../cities/budget-section.js';
import { ExportSection, NO_EXPORT_SECTION, type ExportSectionState } from '../export/export-section.js';
import type { ContentServices, WriteOutcome } from '../content/services.js';
import { layerItemOf, type LayerItem } from '../layers/model.js';
import { PreviewLayer } from '../layers/preview.js';
import { startersFor } from '../pois/starter.js';
import { Store } from '../state/store.js';
import { canAdd, categoryItemOf, inOrder, type CategoryItem } from './categories.js';
import { CategoryArea } from './category-area.js';
import { iconIntents, NO_ICON_SECTION, type IconSectionState } from './icon.js';
import { CITY_SECTIONS, CitySections, NO_CITY_SECTION, type CitySection } from './city-sections.js';
import { settingsIntentsOf } from './intents.js';
import { NO_OVERLAY_DEFAULTS, OverlayDefaults } from './overlay-defaults.js';
import { photosOpacityOf } from './overlays.js';
import { reportOutcome } from './report.js';
import { settingsRoute, type SettingsRoute } from './sections.js';
import { NO_SETTINGS_MAP, SettingsMap } from './settings-map.js';
import type { SettingsIntents, SettingsState } from './state.js';
import { NO_SUPERSEDED, SupersededTiles } from './superseded.js';
import type { ThemeTools } from './theme.js';
const INITIAL: SettingsState = {
    section: null,
    city: LOADING_DOC,
    citySection: NO_CITY_SECTION,
    layers: LOADING_LIST,
    categories: LOADING_LIST,
    canAddCategory: false,
    startersMissing: 0,
    addingStarters: false,
    category: null,
    categoryDeletion: { phase: 'idle' },
    overlays: NO_OVERLAY_DEFAULTS,
    reordering: false,
    map: NO_SETTINGS_MAP,
    export: NO_EXPORT_SECTION,
    budget: NO_BUDGET_SECTION,
    icon: NO_ICON_SECTION,
    superseded: NO_SUPERSEDED,
};
function isCitySection(section: SettingsRoute['section']): section is CitySection {
    return (CITY_SECTIONS as readonly (string | null)[]).includes(section);
}

export class SettingsStore implements AreaStore<SettingsState, SettingsIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<SettingsState>;
    readonly #city: LiveDoc<CityDoc>;
    readonly #layers: LiveList<LayerDoc, LayerItem>;
    readonly #categories: LiveList<PoiCategoryDoc, CategoryItem>;
    readonly #preview = new PreviewLayer();
    readonly #sections: CitySections;
    readonly #overlays: OverlayDefaults;
    readonly #categoryArea: CategoryArea;
    readonly #map: SettingsMap;
    /** M5 (CR-M5-10; owner: export): the export section's listeners, attached while it shows. */
    readonly #export: ExportSection;
    /** M5 (owner: multi-city): the budget section's listeners, attached while it shows. */
    readonly #budget: BudgetSection;
    readonly #superseded: SupersededTiles;
    /** What the section controllers report goes into the page's state (field callbacks keep constructor lines short). */
    readonly #exportChanged = (state: ExportSectionState): void => {
        this.#cell.update({ export: state });
    };
    readonly #budgetChanged = (budget: BudgetSectionState): void => {
        this.#cell.update({ budget });
    };
    /** The tab icon's card: an upload or a reset on its way, and a refusal. */
    readonly #iconChanged = (icon: IconSectionState): void => {
        this.#cell.update({ icon });
    };
    #open = false;
    readonly intents: SettingsIntents;

    constructor(services: ContentServices, tools: ThemeTools) {
        this.#services = services;
        this.#cell = new Store<SettingsState>(INITIAL, services.log);
        const { store, clock, cityId } = services;
        const denied = () => services.denied();
        const listsChanged = () => this.#listsChanged();
        this.#city = this.#newCityDoc(store, clock, denied);
        const liveLists = { store, clock, denied, cityId, changed: listsChanged };
        this.#layers = this.#newLayers(liveLists);
        this.#categories = this.#newCategories(liveLists);
        this.#sections = new CitySections(services, tools, (citySection) => {
            this.#cell.update({ citySection });
            this.#boundsChanged();
        });
        this.#map = this.#newMap(services);
        this.#overlays = this.#newOverlays(services);
        this.#categoryArea = this.#newCategoryArea(services);
        this.#export = new ExportSection(services, this.#exportChanged);
        this.#budget = new BudgetSection(services, this.#budgetChanged);
        this.#superseded = this.#newSuperseded(services);
        this.intents = {
            ...this.#export.intents,
            ...this.#budget.intents,
            ...iconIntents(services, this.#iconChanged),
            ...settingsIntentsOf({
                sections: this.#sections,
                categoryArea: this.#categoryArea,
                overlays: this.#overlays,
                services: this.#services,
                map: this.#map,
                preview: this.#preview,
                reported: (write) => this.#reported(write),
                retry: () => this.#retry(),
            }),
            refreshSuperseded: async () => {
                await this.#superseded.refresh();
            },
            deleteSuperseded: async () => {
                await this.#superseded.deleteAll();
            },
        };
    }

    #newCityDoc(store: ContentServices['store'], clock: ContentServices['clock'], denied: () => void): LiveDoc<CityDoc> {
        return new LiveDoc({
            ...{ store, clock, denied, schema: cityDocSchema },
            changed: (city) => {
                this.#cityChanged(city);
            },
        });
    }

    #newLayers(args: {
        store: ContentServices['store'];
        clock: ContentServices['clock'];
        denied: () => void;
        cityId: string;
        changed: () => void;
    }): LiveList<LayerDoc, LayerItem> {
        const { store, clock, denied, cityId, changed } = args;
        return new LiveList({
            ...{ store, clock, denied, collection: FIRESTORE_PATHS.layers(cityId), schema: layerDocSchema, map: layerItemOf },
            ...{ pageSize: MAX_LAYERS, changed },
        });
    }

    #newCategories(args: {
        store: ContentServices['store'];
        clock: ContentServices['clock'];
        denied: () => void;
        cityId: string;
        changed: () => void;
    }): LiveList<PoiCategoryDoc, CategoryItem> {
        const { store, clock, denied, cityId, changed } = args;
        return new LiveList({
            ...{ store, clock, denied, collection: FIRESTORE_PATHS.poiCategories(cityId), schema: poiCategoryDocSchema },
            ...{ map: categoryItemOf, pageSize: MAX_POI_CATEGORIES + 1, changed },
        });
    }

    #newMap(services: ContentServices): SettingsMap {
        return new SettingsMap({
            ...{ services, preview: this.#preview },
            changed: (map) => {
                this.#cell.update({ map });
            },
            drawn: (bounds) => {
                this.#sections.edit({ bounds });
            },
        });
    }

    #newOverlays(services: ContentServices): OverlayDefaults {
        return new OverlayDefaults(services, this.#preview, (overlays) => {
            this.#cell.update({ overlays });
        });
    }

    #newSuperseded(services: ContentServices): SupersededTiles {
        return new SupersededTiles(services, (superseded) => {
            this.#cell.update({ superseded });
        });
    }

    /** The categories section's moving parts, over the listed layers and categories. */
    #newCategoryArea(services: ContentServices): CategoryArea {
        return new CategoryArea({
            ...{ services, preview: this.#preview },
            changed: (patch) => {
                this.#cell.update(patch);
            },
            categories: () => this.#cell.state.categories.items,
            taken: () => [...this.#cell.state.layers.items, ...this.#cell.state.categories.items].map((item) => item.id),
            starters: () => this.#cell.state.startersMissing,
        });
    }

    get state(): SettingsState {
        return this.#cell.state;
    }

    subscribe(listener: (state: SettingsState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        if (!this.#open) {
            this.#open = true;
            this.#city.show(FIRESTORE_PATHS.city(this.#services.cityId));
            this.#layers.show({ orderBy: [['order', 'desc']] });
            this.#categories.show({ orderBy: [['order', 'asc']] });
        }
        this.#route(settingsRoute(params));
    }

    close(): void {
        this.#open = false;
        this.#route({ section: null, category: null });
        this.#map.detach();
        this.#city.stop();
        this.#layers.stop();
        this.#categories.stop();
    }

    hasUnsavedChanges(): boolean {
        return this.#sections.unsaved || this.#overlays.unsaved || this.#categoryArea.unsaved;
    }

    destroy(): void {
        this.close();
        this.#preview.attach(null);
    }

    /** The area section's bounds on the map as its draft holds them; no rectangle in any other section. */
    #boundsChanged(): void {
        const { section, draft } = this.#sections.state;
        this.#map.showBounds(section === 'area' ? (draft.value?.bounds ?? null) : null);
    }

    async #reported(write: Promise<WriteOutcome | null>): Promise<WriteOutcome | null> {
        const outcome = await write;
        reportOutcome(this.#services, outcome);
        return outcome;
    }

    #route(route: SettingsRoute): void {
        this.#routeExport(route.section === 'export');
        this.#routeBudget(route.section === 'budget');
        this.#routeIcon(route);
        this.#cell.update({ section: route.section });
        this.#sections.open(isCitySection(route.section) ? route.section : null);
        this.#routeSuperseded(route);
        this.#routeOverlays(route);
        this.#categoryArea.open(route.category);
    }

    #routeIcon(route: SettingsRoute): void {
        if (route.section !== 'icon') {
            this.#iconChanged(NO_ICON_SECTION);
        }
    }

    #routeSuperseded(route: SettingsRoute): void {
        if (route.section === 'imagery') {
            void this.#superseded.refresh();
            return;
        }
        if (this.#superseded.state.layers.length > 0 || this.#superseded.state.error !== null) {
            this.#superseded.clear();
        }
    }

    #routeOverlays(route: SettingsRoute): void {
        if (route.section !== 'overlays') {
            this.#overlays.discard();
        }
    }

    /** The export section's listeners follow its route: attached when it opens, detached when it closes. */
    #routeExport(shows: boolean): void {
        if (shows === (this.#cell.state.section === 'export')) {
            return;
        }
        if (shows) {
            this.#export.open();
        } else {
            this.#export.close();
        }
    }

    /** M5: the budget section's listeners follow its route, as the export's do. */
    #routeBudget(shows: boolean): void {
        if (shows === (this.#cell.state.section === 'budget')) {
            return;
        }
        if (shows) {
            this.#budget.open();
        } else {
            this.#budget.close();
        }
    }

    #cityChanged(city: DocState<CityDoc>): void {
        this.#cell.update({ city });
        if (city.status === 'ready') {
            this.#sections.load(city.doc);
            this.#listsChanged();
            if (city.doc !== null) {
                this.#map.setCity(city.doc.data);
            }
        }
    }

    #listsChanged(): void {
        const layers = this.#layers.list;
        const categories = { ...this.#categories.list, items: inOrder(this.#categories.list.items) };
        const listed = categories.status === 'ready';
        const startersMissing = listed ? startersFor(categories.items).length : 0;
        this.#cell.update({ layers, categories, canAddCategory: listed && canAdd(categories.items.length), startersMissing });
        const photos = photosOpacityOf(this.#city.state.doc?.data ?? null);
        this.#overlays.setBase({ layers: layers.items, categories: categories.items, photos });
    }

    #retry(): void {
        this.#city.retry();
        this.#layers.retry();
        this.#categories.retry();
        this.#categoryArea.retry();
    }
}
