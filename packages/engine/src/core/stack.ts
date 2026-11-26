/**
 * How the historical layers stack (V15, the owner 2026-11-13; DECISIONS §133d as changed by §191): the layer the timeline
 * chose is on top, even when it is older than an opaque newer one; the other layers of the timeline's year come under it;
 * every other layer stacks by date, the newest highest. The layer on top is the `front` the visitor chose (a layer switched
 * on, a date picked on the timeline) while it is visible, else the last layer of the timeline's year in manifest order (the
 * one Mapbox would draw last among equals). The URL hash names it last in `layers=` (`hashLayerIds`), so a link stands on
 * the same year with the same layer on top.
 */
import type { Layer, Overlay } from '@hcm/shared';

/** What lifts a layer of the timeline's year above every other year (years are 1500–2100). */
const RAISE = 10_000;

/** What the stack is computed from: the manifest's layers, the overlays' visibility, the timeline and the chosen front. */
export interface StackInput {
    readonly layers: readonly Pick<Layer, 'id' | 'year'>[];
    readonly overlays: readonly Pick<Overlay, 'id' | 'kind' | 'visible'>[];
    readonly year: number | null;
    readonly front: string | null;
}

function visibleIds(overlays: StackInput['overlays']): ReadonlySet<string> {
    return new Set(overlays.filter((overlay) => overlay.kind === 'raster' && overlay.visible).map((overlay) => overlay.id));
}

/** The layer on top: the chosen front while visible, else the last visible layer of the timeline's year; null for none. */
export function frontLayerId(input: StackInput): string | null {
    const visible = visibleIds(input.overlays);
    if (input.front !== null && visible.has(input.front)) {
        return input.front;
    }
    return input.layers.findLast((layer) => layer.year === input.year && visible.has(layer.id))?.id ?? null;
}

/** Each layer's place in the stack (higher on top): the front, then its year's other layers, then the rest by date. */
export function stackOrder(input: StackInput): (layer: Pick<Layer, 'id' | 'year'>) => number {
    const front = frontLayerId(input);
    return (layer) => layer.year + (layer.id === front ? 2 * RAISE : Number(layer.year === input.year) * RAISE);
}

/**
 * The visible layers as `layers=` names them (2026-11-22: the visible place categories first, when they differ from the
 * defaults, so a link keeps them too): in the Layers panel's order, the layer on top moved last; null when they
 * are the manifest's default-visible ones with the same layer on top (the hash then leaves `layers=` out).
 */
export function hashLayerIds(input: StackInput & { readonly defaults: StackInput }): readonly string[] | null {
    const visible = [...visibleIds(input.overlays)];
    const front = frontLayerId(input);
    const ids = front === null ? visible : [...visible.filter((id) => id !== front), front];
    const places = changedPlaces(input.overlays, input.defaults.overlays);
    return places === null && sameAsDefaults(ids, front, input.defaults) ? null : [...(places ?? []), ...ids];
}

/** The visible layers and the one on top are the manifest's defaults. */
function sameAsDefaults(ids: readonly string[], front: string | null, defaults: StackInput): boolean {
    const visible = visibleIds(defaults.overlays);
    return ids.length === visible.size && ids.every((id) => visible.has(id)) && front === frontLayerId(defaults);
}

/** The visible place categories' ids, in list order, when they differ from the defaults; null when they are the defaults. */
function changedPlaces(overlays: StackInput['overlays'], defaults: StackInput['overlays']): readonly string[] | null {
    const shown = (list: StackInput['overlays']): string[] =>
        list.filter((overlay) => overlay.kind === 'poi' && overlay.visible).map((o) => o.id);
    const now = shown(overlays);
    const was = shown(defaults);
    return now.length === was.length && now.every((id, index) => id === was[index]) ? null : now;
}

/** A link's `layers=`: the last known layer it names is the front, and its year the timeline's; none known is "today". */
export function frontOfIds(layers: readonly Pick<Layer, 'id' | 'year'>[], ids: readonly string[]): Pick<StackInput, 'year' | 'front'> {
    const known = ids.filter((id) => layers.some((layer) => layer.id === id));
    const front = known.at(-1);
    const layer = layers.find((candidate) => candidate.id === front);
    return layer === undefined ? { year: null, front: null } : { year: layer.year, front: layer.id };
}
