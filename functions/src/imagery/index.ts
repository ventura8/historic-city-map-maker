/**
 * The `imagery.*` functions (`docs/research/M3-interfaces.md` §9): the callables of the Imagery area, the georeferencer
 * and the layer editor; the dispatcher on job writes, the raster upload trigger, the publisher's task queue and the
 * fifteen-minute tick; M7's choice of where a job runs (`imagery.runOn`); Pause and Resume of a job, every job or a computer
 * (`imagery.pause`, 2026-11-13). `functions/src/index.ts` exports
 * `imagery = imageryFunctions(getDeps, bucket)`, which deploys `imagery-search`, `imagery-browse`, ..., `imagery-tick`.
 */
import type { CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { approveFunction, rejectFunction } from './approve.js';
import { archiveImportFunction } from './archive-import.js';
import { browseFunction } from './browse.js';
import { confirmRightsFunction } from './confirm-rights.js';
import { cropFunction } from './crop.js';
import { deleteVersionFunction } from './delete-version.js';
import { makeLiveFunction } from './make-live.js';
import { importFunction } from './import.js';
import { joinFunction } from './join.js';
import { onJobWriteFunction } from './on-job-write.js';
import { onRasterUploadFunction } from './on-raster-upload.js';
import { probeTilesFunction } from './probe.js';
import { publishFunction } from './publish.js';
import { resumeGuardFunction } from './resume-guard.js';
import { locateAgainFunction } from './locate-again.js';
import { previewUrlFunction } from './preview-url.js';
import { recalibrateFunction } from './recalibrate.js';
import { retryFunction } from './retry.js';
import { pauseFunction } from './pause.js';
import { runOnFunction } from './run-on.js';
import { saveGcpsFunction } from './save-gcps.js';
import { saveLayoutFunction } from './save-layout.js';
import { acceptLayoutFunction } from './accept-layout.js';
import { relayoutFunction } from './relayout.js';
import { markSceneFunction } from './mark-scene.js';
import { searchFunction } from './search.js';
import { chooseFunction, studioDoneFunction } from './studio.js';
import { tickFunction, type TickDeps } from './tick.js';

/** Every port the family uses (the union of its functions' own `Pick<Ports, …>`). */
export type ImageryFamilyDeps = CallableDeps & TickDeps & Pick<Ports, 'reader' | 'uploads' | 'signer' | 'config'>;

export function imageryFunctions(getDeps: () => ImageryFamilyDeps, bucket?: string) {
    return {
        search: searchFunction(getDeps),
        browse: browseFunction(getDeps),
        markScene: markSceneFunction(getDeps),
        import: importFunction(getDeps),
        approve: approveFunction(getDeps),
        reject: rejectFunction(getDeps),
        confirmRights: confirmRightsFunction(getDeps),
        deleteVersion: deleteVersionFunction(getDeps),
        makeLive: makeLiveFunction(getDeps),
        choose: chooseFunction(getDeps),
        studioDone: studioDoneFunction(getDeps),
        saveGcps: saveGcpsFunction(getDeps),
        crop: cropFunction(getDeps),
        join: joinFunction(getDeps),
        retry: retryFunction(getDeps),
        locateAgain: locateAgainFunction(getDeps),
        saveLayout: saveLayoutFunction(getDeps),
        acceptLayout: acceptLayoutFunction(getDeps),
        relayout: relayoutFunction(getDeps),
        previewUrl: previewUrlFunction(getDeps),
        recalibrate: recalibrateFunction(getDeps),
        runOn: runOnFunction(getDeps),
        pause: pauseFunction(getDeps),
        archiveImport: archiveImportFunction(getDeps),
        probeTiles: probeTilesFunction(getDeps),
        resumeGuard: resumeGuardFunction(getDeps),
        onJobWrite: onJobWriteFunction(getDeps),
        onRasterUpload: onRasterUploadFunction(getDeps, bucket),
        publish: publishFunction(getDeps),
        tick: tickFunction(getDeps),
    };
}
