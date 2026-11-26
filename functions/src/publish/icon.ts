/**
 * The city's default tab icon, kept by the manifest's build (`docs/research/M2-interfaces.md` → *The city's tab icon*):
 * a city without an icon (a new one, or one made before icons) gets the default, the Layers panel's map glyph in its
 * seed colour; a default whose colour is no longer the theme's (a theme change requests a build) is drawn again. An icon
 * an editor uploaded is never touched. A failure is logged and never fails the manifest.
 */
import { FIRESTORE_PATHS, cityDocSchema, systemWriter, type CityDoc } from '@hcm/shared';
import { mapIconSvg } from '@hcm/shared/tab-icon';

import { iconSeedOf, iconStamp, recordCityIcon, storeCityIcon, type CityIconDeps } from '../api/city-icon.js';
import type { Ports } from '../ports/index.js';

export type EnsureIconDeps = CityIconDeps & Pick<Ports, 'log'>;

export type IconOutcome = 'drawn' | 'current' | 'failed';

/** The city's icon is an upload, or the default in its current seed colour. */
function current(city: CityDoc): boolean {
    return city.icon?.source === 'custom' || city.icon?.seedColor === iconSeedOf(city);
}

async function draw(deps: EnsureIconDeps, cityId: string): Promise<IconOutcome> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city === undefined || current(city)) {
        return 'current';
    }
    const seedColor = iconSeedOf(city);
    const stored = await storeCityIcon(deps, cityId, { ownSvg: mapIconSvg(seedColor) });
    const icon = { source: 'default' as const, seedColor, ...stored, ...iconStamp(deps, systemWriter('publish')) };
    // An editor's upload while this one drew wins.
    const recorded = await recordCityIcon(deps, cityId, icon, (latest) => latest.icon?.source === 'custom');
    return recorded ? 'drawn' : 'current';
}

/** Draws the city's default icon when it has none or wears an old colour; never throws. */
export async function ensureCityIcon(deps: EnsureIconDeps, cityId: string): Promise<IconOutcome> {
    return draw(deps, cityId).catch((error: unknown) => {
        deps.log.warn('city icon not drawn', { cityId, error: String(error) });
        return 'failed' as const;
    });
}
