/**
 * The local worker's callables (fn-worker, `docs/research/M7-local-worker.md` §2.4): `functions/src/index.ts` exports
 * `worker = workerFunctions(getDeps)`, which Firebase deploys as `worker-hello`, `worker-claim`, `worker-step`,
 * `worker-urls` and `worker-end`. Access `cityEditor`, App Check off (a process on the owner's computer cannot be
 * attested): each call is bound to the one job the caller's worker claimed.
 */
import type { CallableDeps } from '../api/callable.js';
import { archiveCopyFunction, type ArchiveCopyDeps } from './archive-copy.js';
import { archiveReportFunction, type ArchiveReportDeps } from './archive-report.js';
import { claimFunction, type ClaimDeps } from './claim.js';
import { endFunction, type EndDeps } from './end.js';
import { helloFunction, type HelloDeps } from './hello.js';
import { imageFunction, type ImageDeps } from './image.js';
import { manageFunction, type ManageDeps } from './manage.js';
import { pairCodeFunction, type PairCodeDeps } from './pair-code.js';
import { pairFunction, type PairDeps } from './pair.js';
import { revokeFunction, type RevokeDeps } from './revoke.js';
import { starterFunction, type StarterDeps } from './starter.js';
import { stepFunction, type StepDeps } from './step.js';
import { urlsFunction, type UrlsDeps } from './urls.js';

export type WorkerFamilyDeps = CallableDeps &
    HelloDeps &
    ClaimDeps &
    StepDeps &
    UrlsDeps &
    EndDeps &
    PairDeps &
    PairCodeDeps &
    RevokeDeps &
    ManageDeps &
    ImageDeps &
    StarterDeps &
    ArchiveReportDeps &
    ArchiveCopyDeps;

/**
 * `worker.hello`, `worker.claim`, `worker.step`, `worker.urls`, `worker.end`; finding 67's pairing: `worker.pair` (the
 * worker's one-time code exchanged for a sign-in), `worker.pairCode` and `worker.revoke` (the admin's); finding 72's
 * `worker.image` (the installed image the starter's supervisor runs); finding 73's `worker.starter` (the starter file
 * itself, an HTTPS function: a download); W5's `worker.manage` (Rename, Pause, Resume in the admin's list of computers).
 */
export function workerFunctions(getDeps: () => WorkerFamilyDeps) {
    return {
        hello: helloFunction(getDeps),
        claim: claimFunction(getDeps),
        step: stepFunction(getDeps),
        urls: urlsFunction(getDeps),
        end: endFunction(getDeps),
        pair: pairFunction(getDeps),
        pairCode: pairCodeFunction(getDeps),
        revoke: revokeFunction(getDeps),
        manage: manageFunction(getDeps),
        image: imageFunction(getDeps),
        starter: starterFunction(getDeps),
        archiveReport: archiveReportFunction(getDeps),
        archiveCopy: archiveCopyFunction(getDeps),
    };
}
