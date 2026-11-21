/**
 * The Material Symbols Rounded icons the kit bundles. The icon font in `packages/ui/fonts/` is a subset that holds only
 * these ligatures (`npm run fonts:build --workspace @hcm/ui` rebuilds it from this list, `fonts:check` verifies it), so
 * an icon used anywhere in the engine or the admin must be listed here first.
 */
import { POI_ICONS } from '@hcm/shared';

/**
 * Icons of the kit, the viewer and the admin (its navigation, the Setup Assistant's cards: `docs/research/M2b-interfaces.md`
 * §1.6; the M2c editors': `docs/research/M2c-interfaces.md` §10.2, CR-M2c-9; the M3 Imagery area and georeferencer:
 * `docs/research/M3-interfaces.md` §10.8, CR-M3-9; the M4 inbox and assists: `docs/research/M4-interfaces.md` §4, §5); POI
 * category icons are `POI_ICONS` of `@hcm/shared`.
 */
export const UI_ICONS = [
    'account_circle',
    'add',
    'add_location_alt',
    'add_photo_alternate',
    'approval',
    'arrow_back',
    'arrow_downward',
    'arrow_forward',
    'arrow_upward',
    'brightness_auto',
    'broken_image',
    'bug_report',
    'cancel',
    'center_focus_strong',
    'check',
    'check_circle',
    'checklist',
    'chevron_left',
    'chevron_right',
    'close',
    'cloud',
    'compare',
    'content_copy',
    'content_paste',
    'contrast',
    'credit_card',
    'crop',
    'crop_free',
    'crop_square',
    'dark_mode',
    'delete',
    'delete_forever',
    'deselect',
    'done_all',
    'download',
    'drag_indicator',
    'edit',
    'error',
    'expand_less',
    'expand_more',
    'explore',
    'filter_alt',
    'filter_list',
    'fullscreen',
    'fullscreen_exit',
    'group',
    'history',
    'image',
    'info',
    'key',
    'language',
    'layers',
    'layers_clear',
    'light_mode',
    'link',
    'logout',
    'map',
    'menu',
    'more_vert',
    'my_location',
    'notifications',
    'opacity',
    'open_in_new',
    'palette',
    'pause',
    'pending',
    'pending_actions',
    'pentagon',
    'person_add',
    'person_remove',
    'photo_library',
    'place',
    'play_arrow',
    'polyline',
    'publish',
    'refresh',
    'remove',
    'replay',
    'restore',
    'satellite_alt',
    'schedule',
    'search',
    'select_all',
    'send',
    'settings',
    'share',
    'timeline',
    'timer',
    'translate',
    'travel_explore',
    'tune',
    'undo',
    'unpublished',
    'upload',
    'upload_file',
    'visibility',
    'visibility_off',
    'warning',
    'wifi_off',
    'zoom_in',
    'zoom_out',
] as const;

/**
 * The bundled subset: the kit's own icons and the POI category icons. The sorted list of them, which only the font tools
 * read, is `ICONS` of `icons-sorted.ts`: a module of its own, so a bundle that only asks `isBundledIcon` (the viewer's)
 * carries no sort.
 */
const BUNDLED = new Set<string>([...UI_ICONS, ...POI_ICONS]);

/** True when `name` is in the bundled subset (anything else would render as plain letters). */
export function isBundledIcon(name: string): boolean {
    return BUNDLED.has(name);
}
