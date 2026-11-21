import '../global-options.js';

import type { CallableRequest, CallableResponse } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { resumeWithLayout } from './layout-wait.js';

/**
 * `imagery.saveLayout` (a city editor; `docs/research/M20-import-local.md` §19.10; S-A-*-TILE-WIZARD-*): the tile-import wizard's answer
 * on an archive series waiting with `layout-check`. A stale `revision` is refused (`apiError.imagery.layoutStale`); the owner's sheets
 * and seams become `help.layoutAnswer` and the job runs again from `place` (`layout-wait.ts`). With `preview` the pipeline makes the
 * real preview of that layout and waits again; without, it goes on to the stitched picture and points.
 */
export type SaveLayoutDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'imagery.saveLayout'>;
type Response = CallableResponse<'imagery.saveLayout'>;

async function imagerySaveLayout(deps: SaveLayoutDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const { cityId, versionId, revision, sheets, seams, preview } = request;
    const jobId = await deps.documents.transaction((transaction) =>
        resumeWithLayout(transaction, {
            cityId,
            versionId,
            revision,
            answer: (_help, stamp) => ({ revision, sheets, seams, preview, ...stamp }),
            by: caller.uid,
            now: deps.clock.now(),
        }),
    );
    deps.log.info('tile layout saved', { uid: caller.uid, cityId, versionId, revision, sheets: sheets.length, preview });
    return { jobId, versionId };
}

/** The `imagery-saveLayout` callable. */
export function saveLayoutFunction(getDeps: () => SaveLayoutDeps & CallableDeps) {
    return defineCallable('imagery.saveLayout', imagerySaveLayout, getDeps);
}
