/** The FAB menu's items: which actions a viewer offers, and each one's icon and name. */
import { translate, type ViewerLocale, type Manifest, type MessageKey } from '@hcm/shared';

import type { FabMenuItem } from '../components/fab-menu.js';
import type { MenuAction } from './viewer-actions.js';

/** What the menu depends on. */
export interface MenuContext {
    readonly webgl: boolean;
    readonly layersDocked: boolean;
    readonly manifest: Manifest;
}

/** The actions the FAB menu offers: no layers when the panel is docked, no map actions without WebGL, no list without photos. */
export function menuActions({ webgl, layersDocked, manifest }: MenuContext): readonly MenuAction[] {
    const candidates: readonly (readonly [MenuAction, boolean])[] = [
        ['layers', webgl && !layersDocked],
        ['photos', manifest.photos.length > 0],
        ['unplaced', (manifest.unplaced ?? []).length > 0],
        ['stories', (manifest.stories ?? []).length > 0],
        ['locate', webgl],
        ['share', true],
        ['contribute', manifest.contributeUrl !== undefined],
        ['settings', true],
        ['about', true],
    ];
    return candidates.filter(([, shown]) => shown).map(([action]) => action);
}

const MENU_ENTRIES: Readonly<Record<MenuAction, { readonly icon: string; readonly label: MessageKey }>> = {
    layers: { icon: 'layers', label: 'layers.title' },
    photos: { icon: 'photo_library', label: 'photos.list' },
    unplaced: { icon: 'add_location_alt', label: 'unplaced.title' },
    stories: { icon: 'museum', label: 'stories.title' },
    contribute: { icon: 'add_photo_alternate', label: 'contribute.link' },
    locate: { icon: 'my_location', label: 'action.locate' },
    share: { icon: 'share', label: 'action.share' },
    settings: { icon: 'settings', label: 'settings.title' },
    about: { icon: 'info', label: 'about.title' },
};

/** One FAB menu item; Show my location is a switch, checked while `locating` (V10). */
export function menuItem(action: MenuAction, locale: ViewerLocale, locating = false): FabMenuItem {
    const entry = MENU_ENTRIES[action];
    const item = { value: action, icon: entry.icon, label: translate(locale, entry.label) };
    return action === 'locate' ? { ...item, checked: locating } : item;
}
