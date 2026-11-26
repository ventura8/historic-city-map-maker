import '../global-options.js';

import {
    FIRESTORE_PATHS,
    HEARTBEAT_SECONDS,
    WORKER_IDLE_POLL_SECONDS,
    WORKER_POLL_SECONDS,
    workerDocSchema,
    type CallableRequest,
    type CallableResponse,
    type WorkerDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { at, ownWorker, requireGreen } from './holder.js';
import { imageState, paired, type ImageState } from './pairing.js';

export type HelloDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs'>;

/**
 * `worker.hello` (`docs/research/M7-local-worker.md` §1.2, §2.4): a worker process introduces itself before it claims
 * anything, which records `cities/{city}/workers/{workerId}` (its account, its version, when it started and was last
 * seen; a worker id another account said hello with is refused) and answers how often it asks for work and beats.
 * The local page calls it with a fresh token first, so a token of another project or of a non-editor is refused at once.
 * Finding 67: a paired worker's document also names its pairing and its image, and the answer says the installed image
 * and whether the worker's is outdated (it then claims nothing until the owner runs the admin's new command). Finding 72:
 * a worker the starter's supervisor runs names its image (`image`), which is then the one compared (and recorded). M10: it also says
 * its local AI's state (`ai`), again whenever that changes; `<hcm-worker-panel>` shows it. W5: the computer's name and starter
 * version (`host`), for the admin's list of the city's computers.
 */
async function workerHello(
    deps: HelloDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'worker.hello'>,
): Promise<CallableResponse<'worker.hello'>> {
    await requireGreen(deps.documents);
    const call = { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
    const now = at(deps.clock.now());
    const path = FIRESTORE_PATHS.worker(request.cityId, request.workerId);
    const images = await imageState(deps, caller, request.cityId, request.image);
    await deps.documents.transaction(async (transaction) => {
        const known = await ownWorker(transaction, call);
        const base: Pick<WorkerDoc, 'startedAt' | 'state'> = known ?? { startedAt: now, state: 'idle' };
        await transaction.set(path, workerDocSchema, {
            ...known,
            ...base,
            uid: caller.uid,
            version: request.version,
            ...pairingFields(caller, images),
            ...(request.ai === undefined ? {} : { ai: request.ai }),
            ...hostFields(request.host),
            lastSeenAt: now,
            updatedBy: caller.uid,
            updatedAt: now,
        });
    });
    deps.log.info('worker hello', {
        cityId: request.cityId,
        workerId: request.workerId,
        version: request.version,
        outdated: images.outdated,
    });
    const image = images.installed === undefined ? {} : { image: images.installed };
    const timing = { pollSeconds: WORKER_POLL_SECONDS, idlePollSeconds: WORKER_IDLE_POLL_SECONDS, heartbeatSeconds: HEARTBEAT_SECONDS };
    return { ...timing, ...image, outdated: images.outdated };
}

/** A paired worker's document names its pairing, its image and whether that is still the installed one (finding 67). */
function pairingFields(caller: VerifiedCaller, images: ImageState): Partial<WorkerDoc> {
    const pair = caller.worker === undefined ? {} : { pair: caller.worker.pair };
    return { ...pair, ...(images.own === undefined ? {} : { image: images.own }), outdated: images.outdated };
}

/** W5 (household computers): the computer's own name and its starter's version, when the starter passed them on. */
function hostFields(host: CallableRequest<'worker.hello'>['host']): Partial<WorkerDoc> {
    const said = { host: host?.name, os: host?.os, starter: host?.starter };
    return Object.fromEntries(Object.entries(said).filter(([, value]) => value !== undefined));
}

/** The `worker-hello` callable. */
export function helloFunction(getDeps: () => HelloDeps & CallableDeps) {
    return defineCallable('worker.hello', paired(workerHello), getDeps);
}
