/**
 * A harvested scene's rank between harvests (`docs/research/M3-interfaces.md` §3.3): when USGS answers an Import with
 * "not scanned" (`download-options` says the frame is not available after all), the scene records it and is ranked again
 * against the city's target years and the years its layers show, so its card stops saying "Free" and offering an Import
 * that always fails (CR-M3-47). The next harvest takes the search's word again.
 */
import { FIRESTORE_PATHS, cityDocSchema, imagerySettingsOf, rankScene, usgsSceneDocSchema, type UsgsSceneDoc } from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf } from './records.js';
import { rankContextOf, shownYears } from './versions.js';

type RankDeps = Pick<Ports, 'documents' | 'clock'>;

/**
 * The scene's rank now: the city's target years, the years its layers and unfinished versions show (its own left out).
 * M4: the order watch and `usgs.markOrdered` rank a scene again when USGS lists its download.
 */
export async function rankNow(deps: RankDeps, cityId: string, scene: UsgsSceneDoc): Promise<UsgsSceneDoc['rank']> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    const shown = await shownYears(deps.documents, cityId, scene.layerId);
    return rankScene(scene, rankContextOf(imagerySettingsOf(city?.imagery).targetYears, shown));
}

/** The scene is not scanned after all: `downloadAvailable` false, ranked again. */
export async function markNotScanned(deps: RankDeps, cityId: string, entityId: string): Promise<void> {
    const path = FIRESTORE_PATHS.usgsScene(cityId, entityId);
    const scene = await deps.documents.get(path, usgsSceneDocSchema);
    if (scene?.downloadAvailable !== true) {
        return;
    }
    const changed: UsgsSceneDoc = { ...scene, downloadAvailable: false };
    await deps.documents.set(path, usgsSceneDocSchema, {
        ...changed,
        rank: await rankNow(deps, cityId, changed),
        ...stampOf(IMAGERY_WRITER, deps.clock.now()),
    });
}
