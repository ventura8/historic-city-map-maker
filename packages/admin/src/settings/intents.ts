import type { OverlayKind } from '@hcm/shared';

import type { ContentServices, WriteOutcome } from '../content/services.js';
import type { PreviewLayer } from '../layers/preview.js';
import type { CategoryArea } from './category-area.js';
import type { CitySections } from './city-sections.js';
import { viewFields } from './area.js';
import { basemapFor } from './theme.js';
import { editedCredits, movedCredit, withCredit, withoutCredit } from './texts.js';
import type { OverlayDefaults } from './overlay-defaults.js';
import type { SettingsMap } from './settings-map.js';
import type { SettingsIntents } from './state.js';

interface SharedDeps {
    readonly sections: CitySections;
    readonly categoryArea: CategoryArea;
    readonly overlays: OverlayDefaults;
    readonly services: ContentServices;
    readonly map: SettingsMap;
    readonly preview: PreviewLayer;
    readonly reported: (write: Promise<WriteOutcome | null>) => Promise<WriteOutcome | null>;
    readonly retry: () => void;
}

export function settingsIntentsOf(deps: SharedDeps): SettingsIntents {
    const city = cityIntentsOf(deps);
    const credits = creditIntentsOf(deps.sections);
    const other = otherIntentsOf(deps);
    const map = mapIntentsOf(deps.map, deps.sections);
    return { ...city, ...credits, ...other, ...map, ...deps.categoryArea.intents };
}

function cityIntentsOf(
    deps: Pick<SharedDeps, 'sections' | 'categoryArea' | 'reported'>,
): Pick<
    SettingsIntents,
    | 'editCity'
    | 'setNumber'
    | 'setText'
    | 'useView'
    | 'setSeed'
    | 'setBasemap'
    | 'saveSection'
    | 'discardSection'
    | 'keepMine'
    | 'takeTheirs'
> {
    const { sections, categoryArea, reported } = deps;
    return {
        editCity: (patch) => {
            sections.edit(patch);
        },
        setNumber: (field, text) => {
            sections.setNumber(field, text);
        },
        setText: (field, locale, text) => {
            sections.setText(field, locale, text);
        },
        useView: (view) => {
            sections.edit(viewFields(view));
        },
        setSeed: (typed) => {
            sections.setSeed(typed);
        },
        setBasemap: (choice) => {
            sections.edit({ basemap: basemapFor(choice, sections.state.draft.value?.basemap) });
        },
        saveSection: () => reported(sections.save()),
        discardSection: () => {
            sections.discard();
        },
        keepMine: () => {
            sections.keepMine();
            categoryArea.keepMine();
        },
        takeTheirs: () => {
            sections.takeTheirs();
            categoryArea.takeTheirs();
        },
    };
}

function creditIntentsOf(sections: CitySections): Pick<SettingsIntents, 'addCredit' | 'removeCredit' | 'moveCredit' | 'editCredit'> {
    return {
        addCredit: () => {
            sections.editCredits(withCredit);
        },
        removeCredit: (row) => {
            sections.editCredits((credits) => withoutCredit(credits, row));
        },
        moveCredit: (row, by) => {
            sections.editCredits((credits) => movedCredit(credits, row, by));
        },
        editCredit: (row, field, text) => {
            sections.editCredits((credits) => editedCredits(credits, row, field, text));
        },
    };
}

function otherIntentsOf(
    deps: Pick<SharedDeps, 'overlays' | 'services' | 'preview' | 'retry' | 'reported'>,
): Pick<SettingsIntents, 'retry' | 'setOverlayOpacity' | 'setShownAtStart' | 'saveOverlays' | 'discardOverlays' | 'attachPreview'> {
    const { overlays, services, preview, retry, reported } = deps;
    return {
        retry: () => {
            retry();
        },
        setOverlayOpacity: (kind: OverlayKind, id: string, percent: number) => {
            if (!services.readOnly()) {
                overlays.setOpacity(kind, id, percent);
            }
        },
        setShownAtStart: (id, visible) => {
            if (!services.readOnly()) {
                overlays.setShownAtStart(id, visible);
            }
        },
        saveOverlays: () => reported(overlays.save()),
        discardOverlays: () => {
            overlays.discard();
        },
        attachPreview: (sink) => {
            preview.attach(sink);
        },
    };
}

function mapIntentsOf(
    map: SettingsMap,
    sections: CitySections,
): Pick<SettingsIntents, 'attachMap' | 'zoomBy' | 'drawBounds' | 'useMapView'> {
    return {
        attachMap: (container) => {
            map.attach(container);
        },
        zoomBy: (delta) => {
            map.zoomBy(delta);
        },
        drawBounds: () => {
            map.toggleDrawing();
        },
        useMapView: () => {
            const view = map.view();
            if (view !== null) {
                sections.edit(viewFields(view));
            }
        },
    };
}
