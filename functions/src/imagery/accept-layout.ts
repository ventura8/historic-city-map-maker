import '../global-options.js';

import type { CallableRequest, CallableResponse, HelpItem } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { resumeWithLayout } from './layout-wait.js';
import type { SaveLayoutDeps } from './save-layout.js';

/**
 * `imagery.acceptLayout` (a city editor; `docs/research/M20-import-local.md` §19.10): the layout of `revision` as it stands, accepted.
 * The owner's earlier answer is kept (its sheets and seams, which that layout already shows), marked `accepted`, and the job runs
 * again from `place`, which mosaics the series with it and sends it on to points (`layout-wait.ts`).
 */
type Request = CallableRequest<'imagery.acceptLayout'>;
type Response = CallableResponse<'imagery.acceptLayout'>;

/** The owner's earlier sheets and seams, or none. */
function earlier(help: HelpItem): Pick<NonNullable<HelpItem['layoutAnswer']>, 'sheets' | 'seams'> {
    const answer = help.layoutAnswer;
    return answer === undefined ? { sheets: [], seams: [] } : { sheets: answer.sheets, seams: answer.seams };
}

async function imageryAcceptLayout(deps: SaveLayoutDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const { cityId, versionId, revision } = request;
    const jobId = await deps.documents.transaction((transaction) =>
        resumeWithLayout(transaction, {
            cityId,
            versionId,
            revision,
            answer: (help, stamp) => ({ ...earlier(help), revision, preview: false, accepted: true, ...stamp }),
            by: caller.uid,
            now: deps.clock.now(),
        }),
    );
    deps.log.info('tile layout accepted', { uid: caller.uid, cityId, versionId, revision });
    return { jobId, versionId };
}

/** The `imagery-acceptLayout` callable. */
export function acceptLayoutFunction(getDeps: () => SaveLayoutDeps & CallableDeps) {
    return defineCallable('imagery.acceptLayout', imageryAcceptLayout, getDeps);
}
