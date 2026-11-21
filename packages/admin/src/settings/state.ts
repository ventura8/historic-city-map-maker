/**
 * The settings area's state and intents (`docs/research/M2c-interfaces.md` §8.5): the open section, the city, the
 * layers and categories as read, the open city section's draft, the open category, a category's deletion, the overlays'
 * defaults and a reorder being written; and what the module needs besides `ContentServices`.
 */
import type { CityDoc, UiLocale, OverlayKind } from '@hcm/shared';

import type { DocState } from '../content/doc.js';
import type { ListState } from '../content/list.js';
import type { WriteOutcome } from '../content/services.js';
import type { BudgetIntents, BudgetSectionState } from '../cities/budget-section.js';
import type { ExportIntents, ExportSectionState } from '../export/export-section.js';
import type { LayerItem } from '../layers/model.js';
import type { PreviewSink } from '../layers/preview.js';
import type { AreaNumberField } from './area.js';
import type { CategoryItem } from './categories.js';
import type { CategoryDeletionState } from './category-deletion.js';
import type { CategoryIntents } from './category-area.js';
import type { IconIntents, IconSectionState } from './icon.js';
import type { CategoryEditorState } from './category-editor.js';
import type { CitySectionState } from './city-sections.js';
import type { OverlayDefaultsState } from './overlay-defaults.js';
import type { SettingsMapState } from './settings-map.js';
import type { SettingsSection } from './sections.js';
import type { BasemapChoice, ThemeTools } from './theme.js';

export interface SettingsState {
    /** `#/settings/<section>`, or null on the list of sections. */
    readonly section: SettingsSection | null;
    /** The city document's listener (the area, texts, theme and the photos overlay read it). */
    readonly city: DocState<CityDoc>;
    /** The open city section's draft (area, texts or theme). */
    readonly citySection: CitySectionState;
    readonly layers: ListState<LayerItem>;
    readonly categories: ListState<CategoryItem>;
    /** At most `MAX_POI_CATEGORIES`: Add category is off at the limit (S-A39-BAD-LIMIT). */
    readonly canAddCategory: boolean;
    /** How many starter categories **Add the starter categories** adds (finding 41: 0 when every one is there). */
    readonly startersMissing: number;
    /** The starter categories are being written. */
    readonly addingStarters: boolean;
    /** `#/settings/categories/<id>`. */
    readonly category: CategoryEditorState | null;
    readonly categoryDeletion: CategoryDeletionState;
    readonly overlays: OverlayDefaultsState;
    /** A reorder of the categories is being written. */
    readonly reordering: boolean;
    /** The page's map (the area and overlays sections): its state and a rectangle being drawn. */
    readonly map: SettingsMapState;
    /** M5 (CR-M5-10; owner: export): Export the city, followed while its section shows. */
    readonly export: ExportSectionState;
    /** M5 (owner: multi-city): the city's budget, followed while its section shows. */
    readonly budget: BudgetSectionState;
    /** The browser tab icon's card (`./icon.ts`). */
    readonly icon: IconSectionState;
}

export interface SettingsIntents extends CategoryIntents, ExportIntents, BudgetIntents, IconIntents {
    retry(): void;
    /** A field of the open city section (`bounds`, `center`, `zoom`, `minZoom`, `maxZoom`, `basemap`, ...). */
    editCity(patch: Partial<CityDoc>): void;
    /** A number of the area as typed: an edge of the bounds, the start centre, the start zoom, a zoom limit. */
    setNumber(field: AreaNumberField, text: string): void;
    /** The name, About or privacy text in one language. */
    setText(field: 'name' | 'about' | 'privacy', locale: UiLocale, text: string): void;
    addCredit(): void;
    removeCredit(row: number): void;
    moveCredit(row: number, by: -1 | 1): void;
    editCredit(row: number, field: 'ro' | 'en' | 'url', text: string): void;
    /** **Use this view**: the map's centre and zoom become the city's start view. */
    useView(view: { readonly center: readonly [number, number]; readonly zoom: number }): void;
    setSeed(typed: string): void;
    setBasemap(choice: BasemapChoice): void;
    saveSection(): Promise<WriteOutcome | null>;
    discardSection(): void;
    /** A conflict of the open section or category: keep the draft's changes. */
    keepMine(): void;
    /** A conflict of the open section or category: take the other version where both changed. */
    takeTheirs(): void;
    setOverlayOpacity(kind: OverlayKind, id: string, percent: number): void;
    setShownAtStart(id: string, visible: boolean): void;
    saveOverlays(): Promise<WriteOutcome | null>;
    discardOverlays(): void;
    attachPreview(sink: PreviewSink | null): void;
    /** The page shows its map host (`hcm-admin-map`'s `hcm-map-host`): the map is created into it. */
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    /** **Draw the area**: the next two clicks on the map are two opposite corners of the bounds (again: stop drawing). */
    drawBounds(): void;
    /** **Use this view**: the map's centre and zoom become the city's start view. */
    useMapView(): void;
}

/** What the settings module needs besides `ContentServices`: the theme's contrast check (`@hcm/ui/dynamic-color`). */
export interface SettingsOptions {
    readonly passes: ThemeTools['passes'];
}
