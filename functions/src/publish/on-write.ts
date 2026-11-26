import { runAs } from '../global-options.js';

import { BACKGROUND_FUNCTIONS, CITY_ID_PATTERN, systemWriter, type HistoryEntity } from '@hcm/shared';
import { onDocumentWritten, type Change, type DocumentSnapshot, type FirestoreEvent } from 'firebase-functions/firestore';

import { needsManifestBuild, type RawDocument } from './fields.js';
import { requestManifestBuild, type RequestDeps } from './request.js';

/**
 * `publish.on{City,Layer,Photo,Poi,PoiCategory,Story}Write`, the pure handler: requests a manifest build when the write can
 * change the manifest (`needsManifestBuild`). Returns whether it did.
 */
export async function onContentWrite(
    deps: RequestDeps,
    entity: HistoryEntity,
    cityId: string,
    change: { readonly before: RawDocument; readonly after: RawDocument },
): Promise<boolean> {
    if (!needsManifestBuild(entity, change.before, change.after)) {
        return false;
    }
    if (!CITY_ID_PATTERN.test(cityId)) {
        deps.log.warn('content written under a city id no manifest can have', { entity, cityId });
        return false;
    }
    await requestManifestBuild(deps, { cityId, full: false, updatedBy: systemWriter('publish') });
    return true;
}

type WriteEvent = FirestoreEvent<Change<DocumentSnapshot> | undefined, { readonly city: string }>;

/** No automatic retry: a lost request is caught by the next write, the builder's own re-queue and the nightly rebuild. */
const OPTIONS = { maxInstances: 5, retry: false } as const;

function handler(getDeps: () => RequestDeps, entity: HistoryEntity) {
    return async (event: WriteEvent): Promise<void> => {
        await onContentWrite(getDeps(), entity, event.params.city, { before: event.data?.before.data(), after: event.data?.after.data() });
    };
}

/** The six Firestore triggers, on the default database, under their registry names (`publish-onPhotoWrite`, ...). */
export function onWriteFunctions(getDeps: () => RequestDeps) {
    return {
        onCityWrite: onDocumentWritten(
            { ...OPTIONS, ...runAs('publish.onCityWrite'), document: BACKGROUND_FUNCTIONS['publish.onCityWrite'].source },
            handler(getDeps, 'city'),
        ),
        onLayerWrite: onDocumentWritten(
            { ...OPTIONS, ...runAs('publish.onLayerWrite'), document: BACKGROUND_FUNCTIONS['publish.onLayerWrite'].source },
            handler(getDeps, 'layer'),
        ),
        onPhotoWrite: onDocumentWritten(
            { ...OPTIONS, ...runAs('publish.onPhotoWrite'), document: BACKGROUND_FUNCTIONS['publish.onPhotoWrite'].source },
            handler(getDeps, 'photo'),
        ),
        onPoiWrite: onDocumentWritten(
            { ...OPTIONS, ...runAs('publish.onPoiWrite'), document: BACKGROUND_FUNCTIONS['publish.onPoiWrite'].source },
            handler(getDeps, 'poi'),
        ),
        onPoiCategoryWrite: onDocumentWritten(
            { ...OPTIONS, ...runAs('publish.onPoiCategoryWrite'), document: BACKGROUND_FUNCTIONS['publish.onPoiCategoryWrite'].source },
            handler(getDeps, 'poiCategory'),
        ),
        onStoryWrite: onDocumentWritten(
            { ...OPTIONS, ...runAs('publish.onStoryWrite'), document: BACKGROUND_FUNCTIONS['publish.onStoryWrite'].source },
            handler(getDeps, 'story'),
        ),
    };
}
