/**
 * A place category's sub-groups (the owner, 2026-11-22: "every Locuri category that holds more than one kind gets a
 * chevron"): a place's `group` when an import set one (bridges, lakes, ponds…), else its geometry (points, lines, areas).
 * The Layers panel lists one switch per sub-group under a category with two or more; the map leaves out the places of a
 * sub-group switched off (`Overlay.hiddenGroups`).
 */
import type { Poi } from '../schemas/poi.js';
import type { Overlay } from './model.js';

/** The sub-group of a place without its own `group`: its geometry's kind. */
export const GEOMETRY_GROUPS = { Point: 'points', LineString: 'lines', Polygon: 'areas' } as const;

export type GeometryGroup = (typeof GEOMETRY_GROUPS)[keyof typeof GEOMETRY_GROUPS];

/** A place's sub-group. */
export function poiGroupOf(poi: Pick<Poi, 'group' | 'geometry'>): string {
    return poi.group ?? GEOMETRY_GROUPS[poi.geometry.type];
}

/** The sub-groups of a category's places, in the order they first appear; one or none means the category has no chevron. */
export function categoryGroups(pois: readonly Pick<Poi, 'category' | 'group' | 'geometry'>[], categoryId: string): readonly string[] {
    return [...new Set(pois.filter((poi) => poi.category === categoryId).map(poiGroupOf))];
}

/** `groups` turned on or off in the overlay `id` (a category); turning one on turns the category on. Unchanged list if nothing moves. */
export function withOverlayGroup(overlays: readonly Overlay[], id: string, group: string, visible: boolean): readonly Overlay[] {
    return overlays.map((target) => {
        if (target.id !== id) {
            return target;
        }
        const hidden = new Set(target.hiddenGroups ?? []);
        if (visible) {
            hidden.delete(group);
        } else {
            hidden.add(group);
        }
        return { ...target, visible: target.visible || visible, hiddenGroups: [...hidden] };
    });
}

/** Whether a place of `poi`'s sub-group shows in the overlay (its category's). */
export function groupShown(overlay: Pick<Overlay, 'hiddenGroups'> | undefined, poi: Pick<Poi, 'group' | 'geometry'>): boolean {
    return !(overlay?.hiddenGroups ?? []).includes(poiGroupOf(poi));
}
