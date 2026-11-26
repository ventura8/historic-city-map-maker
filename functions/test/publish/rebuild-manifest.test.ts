/** `publish.rebuildManifest`: an admin asks for a build of an existing city; the request is stamped with their uid. */
import { FIRESTORE_PATHS, manifestStateDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { publishFunctions } from '../../src/publish/index.js';
import { rebuildManifest, rebuildManifestFunction } from '../../src/publish/rebuild-manifest.js';
import { CITY_ID, cityDoc } from './city.js';
import { adminCall, contentDeps } from './fakes.js';

const ADMIN = { uid: 'u-admin', email: undefined, claim: true } as const;

describe('rebuildManifest', () => {
    it('happyPath_aFullBuildIsRequestedByDefault', async () => {
        const deps = contentDeps();
        deps.documents.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc());

        await expect(rebuildManifest(deps, ADMIN, { cityId: CITY_ID })).resolves.toEqual({ requestedVersion: 1, queued: true });
        expect(deps.tasks.queued[0]?.payload).toEqual({ cityId: CITY_ID, requestedVersion: 1, full: true });
        expect(await deps.documents.get(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema)).toMatchObject({
            updatedBy: 'u-admin',
        });
    });

    it('happyPath_aCityTheSchemaRefusesStillGetsItsBuild', async () => {
        const deps = contentDeps();
        deps.documents.seed(FIRESTORE_PATHS.city(CITY_ID), { ...cityDoc(), name: 'not localized' });

        await expect(rebuildManifest(deps, ADMIN, { cityId: CITY_ID, full: false })).resolves.toMatchObject({ queued: true });
        expect(deps.tasks.queued[0]?.payload).toMatchObject({ full: false });
    });

    it('badPath_anUnknownCityIsNotFound', async () => {
        const deps = contentDeps();

        await expect(rebuildManifest(deps, ADMIN, { cityId: 'nowhere' })).rejects.toMatchObject({ code: 'apiError.notFound' });
        expect(deps.tasks.queued).toEqual([]);
    });

    it('badPath_aFailingReadIsNotTakenForAMissingCity', async () => {
        const deps = contentDeps();
        deps.documents.recorder.failNext('get', new Error('firestore down'));

        await expect(rebuildManifest(deps, ADMIN, { cityId: CITY_ID })).rejects.toThrow('firestore down');
    });
});

describe('publish-rebuildManifest', () => {
    it('happyPath_anAdminCallsItThroughTheCallable', async () => {
        const deps = contentDeps();
        deps.documents.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc());

        await expect(rebuildManifestFunction(() => deps).run(adminCall({ cityId: CITY_ID }))).resolves.toEqual({
            requestedVersion: 1,
            queued: true,
        });
    });

    it('badPath_anInvalidCityIdIsAnInvalidRequest', async () => {
        await expect(rebuildManifestFunction(() => contentDeps()).run(adminCall({ cityId: 'Not A City' }))).rejects.toMatchObject({
            code: 'invalid-argument',
            details: { code: 'apiError.invalidRequest' },
        });
    });

    it('happyPath_theGroupHasTheRegistryNames', () => {
        expect(Object.keys(publishFunctions(() => contentDeps())).sort((a, b) => a.localeCompare(b))).toEqual([
            'buildManifest',
            'onCityWrite',
            'onLayerWrite',
            'onPhotoWrite',
            'onPoiCategoryWrite',
            'onPoiWrite',
            'onStoryWrite',
            'rebuildManifest',
        ]);
    });
});
