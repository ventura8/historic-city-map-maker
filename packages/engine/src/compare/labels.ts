/**
 * What compare's surface shows for a viewer state (M4, docs/research/M4-interfaces.md §3.5–§3.7): the main side's name
 * (its visible historical layers, or today), every side the visitor may compare with in the timeline's order (the layers
 * by year, then today; not what the main side shows already, which would compare a side with itself, unless it is the
 * side compared now), and the compared layer's source, which the bar credits because the second map's own attribution is
 * hidden (one Mapbox logo and attribution on the map, the viewer map's). Pure; texts in the state's language.
 */
import { overlayLabel, translate, type Manifest } from '@hcm/shared';
import { localizedCredit } from '@hcm/shared/credits';
import type { CompareChoice, CompareUiProps } from '@hcm/ui/viewer/compare';

import { compareModeOf, overlayName, type CompareView, type ViewerState } from '../core/state.js';

/** The historical layers the main side shows, in list order. */
function mainSideLayers(state: ViewerState): ViewerState['overlays'] {
    return state.overlays.filter((overlay) => overlay.kind === 'raster' && overlay.visible);
}

/** The main side's name: its visible historical layers in list order, or today. */
export function mainSideLabel(state: ViewerState): string {
    const visible = mainSideLayers(state);
    return visible.length === 0
        ? translate(state.locale, 'compare.today')
        : visible.map((overlay) => overlayLabel(overlay, state.locale)).join(', ');
}

/** The sides the main side shows: its visible historical layers, or today (null) when it shows none. */
function mainSides(state: ViewerState): ReadonlySet<string | null> {
    const visible = mainSideLayers(state).map((overlay) => overlay.id);
    return new Set<string | null>(visible.length === 0 ? [null] : visible);
}

/**
 * The sides to compare with: the historical layers oldest first (the timeline's order), then today, leaving out what the
 * main side shows (a side compared with itself) but never the side compared now.
 */
export function compareChoices(state: ViewerState, manifest: Manifest): readonly CompareChoice[] {
    const layers = [...manifest.layers].sort((a, b) => a.year - b.year);
    const shown = mainSides(state);
    const compared = state.compare?.layerId;
    const all: readonly CompareChoice[] = [
        ...layers.map((layer) => ({ layerId: layer.id, label: overlayName(state, layer.id) })),
        { layerId: null, label: translate(state.locale, 'compare.today') },
    ];
    return all.filter((choice) => choice.layerId === compared || !shown.has(choice.layerId));
}

/** "Sursa: USGS EROS" for a compared layer; `''` for today. */
export function compareCredit(state: ViewerState, manifest: Manifest, layerId: string | null): string {
    const layer = manifest.layers.find((candidate) => candidate.id === layerId);
    return layer === undefined
        ? ''
        : translate(state.locale, 'layers.attribution', { attribution: localizedCredit(layer.attribution, state.locale) });
}

/** The surface's props for `state` while it compares (`compare` is the state's). */
export function compareUiProps(state: ViewerState, manifest: Manifest, compare: CompareView): CompareUiProps {
    return {
        locale: state.locale,
        mode: compareModeOf(state),
        position: compare.position,
        mainLabel: mainSideLabel(state),
        layerId: compare.layerId,
        choices: compareChoices(state, manifest),
        credit: compareCredit(state, manifest, compare.layerId),
    };
}
