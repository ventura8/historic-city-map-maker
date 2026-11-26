/**
 * Every bundled icon, sorted and without duplicates: the kit's own (`UI_ICONS`) and the POI category icons. The icon font
 * is subset to this list (`packages/ui/scripts/build-fonts.mjs`). Kept apart from `icons.ts`, which the viewer bundles for
 * `isBundledIcon`, so the engine's IIFE does not sort a list it only looks names up in.
 */
import { POI_ICONS } from '@hcm/shared';

import { UI_ICONS } from './icons.js';

export const ICONS: readonly string[] = [...new Set<string>([...UI_ICONS, ...POI_ICONS])].toSorted((a, b) => a.localeCompare(b, 'en'));
