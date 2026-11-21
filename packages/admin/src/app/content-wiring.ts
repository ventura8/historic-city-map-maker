/**
 * The services the editor areas bring for each other (`docs/research/M2c-interfaces.md` §2.2, §11.2): the photos'
 * resumable uploads, the pois' map factory with Terra Draw. Each owner declares its member inside its own section of
 * `../content/services.ts` and builds it inside the same section here, from the entry's browser parts and Firebase
 * handles; nobody edits another's section or moves the markers.
 */
import { createLogger } from '@hcm/shared';
import { loadTerraDraw } from '@hcm/ui/map/draw';

import type { AreaServiceParts } from '../content/services.js';
import { documentsPort } from '../firebase/adapters.js';
import type { FirebaseHandles } from '../firebase/app.js';
import { firebaseSdk } from '../firebase/sdk.js';
import { FILES_SDK, firebaseFiles } from '../firebase/files.js';
import { firebasePush, loadMessagingSdk, standInPush, type PushScope } from '../firebase/messaging.js';
import { firebaseUploads, UPLOAD_SDK } from '../firebase/uploads.js';
import { browserPictures } from '../imagery/pictures.js';
import { cropChunkLoader } from '../layers/crop-chunk.js';
import { adminMapFactoryOf } from '../map/wiring.js';

/** What the areas' services are built from. */
export interface AreaServiceSources {
    readonly handles: FirebaseHandles;
    /** The page's `fetch`. */
    readonly fetch: typeof fetch;
    /** The `e2e` build's map token for the test's own city (`E2eKit.mapToken`: null for none); undefined in production. */
    readonly mapToken?: string | null | undefined;
    /** The `e2e` build's test id (`?test=`): push through the stand-in registrar, never FCM; undefined in production. */
    readonly pushTest?: string | undefined;
    /** `runtime.json`'s release and build time (Home reads the recorded installs against them), or null without one. */
    readonly adminRelease?: AreaServiceParts['adminRelease'];
}

/** This browser's push: FCM in production, the stand-in in the `e2e` build (M4, `../firebase/messaging.ts`). */
function pushOf(sources: AreaServiceSources) {
    const scope = globalThis as unknown as PushScope;
    return sources.pushTest === undefined
        ? firebasePush({ scope, app: sources.handles.app, load: loadMessagingSdk })
        : standInPush(scope, sources.pushTest);
}

export function areaServices(sources: AreaServiceSources): AreaServiceParts {
    return {
        // [section photos] owner: photos
        uploads: firebaseUploads(UPLOAD_SDK, sources.handles.storage),
        // [end photos]
        // [section pois] owner: pois
        maps: adminMapFactoryOf({
            scope: globalThis,
            readDoc: (path) => documentsPort(firebaseSdk, sources.handles).get(path),
            // Terra Draw's drags, loaded with the first drawing tools (CR-M2c-20, DECISIONS-for-review.md §34g); the click
            // tools and the vertex list stay the single-pointer and keyboard ways, and the fallback if it fails to load.
            terraDraw: loadTerraDraw,
            log: createLogger('admin-map'),
            fixedToken: sources.mapToken,
        }),
        // [end pois]
        // [section imagery] owner: admin-imagery
        files: firebaseFiles(FILES_SDK, sources.handles.storage, globalThis, createLogger('admin-files')),
        pictures: browserPictures(globalThis),
        layerCrop: cropChunkLoader(() => globalThis.customElements),
        // [end imagery]
        // [section inbox] owner: assists-notify
        push: pushOf(sources),
        // [end inbox]
        // [section install] owner: installer
        adminRelease: sources.adminRelease ?? null,
        // [end install]
    };
}
