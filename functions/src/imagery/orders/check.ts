/**
 * Asking USGS whether bought scans are delivered (`docs/research/M4-interfaces.md` §1.5 step 2, §1.4 "Check now"): one
 * login for all of them (logout in a `finally`), `download-options` per dataset with at most 50 entity ids a call, and
 * each answer recorded on its order in its own transaction. A scene USGS lists becomes `delivered` (and free: its
 * download is there), its EarthExplorer id kept, ranked again, and the admins are told. A failed call is every asked
 * order's failure: asked again sooner, its code shown on the card; a refused login also marks Setup's USGS card.
 */
import { type UsgsSceneDoc } from '@hcm/shared';

import { ApiError } from '../../api/api-error.js';
import type { Ports } from '../../ports/index.js';
import type { DownloadOption } from '../../ports/usgs-scenes.js';
import { IMAGERY_WRITER } from '../records.js';
import { rankNow } from '../scene-rank.js';
import { noteUsgsRefusal } from '../usgs-status.js';
import { usgsError, withUsgs } from '../usgs-session.js';
import { emitOrderEvent } from './events.js';
import { afterCheck, type CheckOutcome } from './order.js';
import { eeDatasetIdOf, updateOrder, type OrderedScene, type Writer } from './scene-order.js';

export type CheckDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'secrets' | 'usgs' | 'scenes' | 'setup'>;

/** `download-options` takes at most this many entity ids a call. */
const BATCH = 50;

/** One asked order: the scene as written after the answer (or as read, when its order had moved on), and the answer. */
export interface Checked {
    readonly scene: OrderedScene;
    readonly outcome: CheckOutcome;
}

/** The code a failed USGS call is recorded with (one USGS did not explain: not answering). */
function failedWith(error: unknown): CheckOutcome {
    const mapped = usgsError(error);
    return { kind: 'failed', code: mapped instanceof ApiError ? mapped.code : 'apiError.usgs.unavailable' };
}

/** One `download-options` call: scenes of one dataset. */
interface Batch {
    readonly dataset: UsgsSceneDoc['dataset'];
    readonly scenes: readonly OrderedScene[];
}

/** An asked scene and its answer. */
type Answer = readonly [scene: OrderedScene, outcome: CheckOutcome];

/** The scenes in batches: one dataset each, at most {@link BATCH} long. */
function batches(scenes: readonly OrderedScene[]): Batch[] {
    const datasets = [...new Set(scenes.map((scene) => scene.dataset))];
    return datasets.flatMap((dataset) => {
        const group = scenes.filter((scene) => scene.dataset === dataset);
        return Array.from({ length: Math.ceil(group.length / BATCH) }, (_unused, index) => ({
            dataset,
            scenes: group.slice(index * BATCH, (index + 1) * BATCH),
        }));
    });
}

/** Whether USGS listed the scene's download, by the options it answered. */
function answerOf(options: readonly DownloadOption[], scene: UsgsSceneDoc): CheckOutcome {
    const option = options.find((candidate) => candidate.entityId === scene.entityId && candidate.available);
    return option === undefined ? { kind: 'waiting' } : { kind: 'available', datasetId: option.datasetId };
}

/** Asks about one batch: each scene listed or not, or the batch's failure for all of them. */
async function askBatch(deps: CheckDeps, apiKey: string, batch: Batch): Promise<Answer[]> {
    try {
        const options = await deps.scenes.downloadOptions(
            apiKey,
            batch.dataset,
            batch.scenes.map((scene) => scene.entityId),
        );
        return batch.scenes.map((scene): Answer => [scene, answerOf(options, scene)]);
    } catch (error) {
        deps.log.warn('usgs order check failed', { dataset: batch.dataset, error: String(error) });
        await noteUsgsRefusal(deps, usgsError(error), deps.clock.now());
        const failure = failedWith(error);
        return batch.scenes.map((scene): Answer => [scene, failure]);
    }
}

/** Every scene's answer, in one USGS session; a session that could not start is every scene's failure. */
async function ask(deps: CheckDeps, scenes: readonly OrderedScene[], now: Date): Promise<Answer[]> {
    try {
        return await withUsgs(deps, async (apiKey) => {
            const answers: Answer[] = [];
            for (const batch of batches(scenes)) {
                answers.push(...(await askBatch(deps, apiKey, batch)));
            }
            return answers;
        });
    } catch (error) {
        await noteUsgsRefusal(deps, error, now);
        const failure = failedWith(error);
        return scenes.map((scene): Answer => [scene, failure]);
    }
}

/** What a delivery changes on the scene besides its order: free now, its EarthExplorer id kept, ranked again. */
type Delivery = Partial<Pick<UsgsSceneDoc, 'downloadAvailable' | 'rank' | 'eeDatasetId'>>;

async function deliveryOf(deps: CheckDeps, cityId: string, scene: UsgsSceneDoc, outcome: CheckOutcome): Promise<Delivery> {
    if (outcome.kind !== 'available') {
        return {};
    }
    const free: UsgsSceneDoc = { ...scene, downloadAvailable: true, ...eeDatasetIdOf(scene.eeDatasetId ?? outcome.datasetId) };
    return { downloadAvailable: true, rank: await rankNow(deps, cityId, free), ...eeDatasetIdOf(free.eeDatasetId) };
}

/** Who asked about the orders of which city, when. */
interface Asked {
    readonly cityId: string;
    readonly writer: Writer;
}

/** Records one answer on the scene's order while it is still in the state it was read in. */
async function record(deps: CheckDeps, asked: Asked, scene: OrderedScene, outcome: CheckOutcome): Promise<Checked> {
    const { cityId, writer } = asked;
    const delivery = await deliveryOf(deps, cityId, scene, outcome);
    const written = await updateOrder(
        deps.documents,
        { cityId, entityId: scene.entityId, states: [scene.order.state] },
        (current) => ({ ...current, ...delivery, order: afterCheck(current.order, outcome, writer.now) }),
        writer,
    );
    if (written === undefined) {
        return { scene, outcome };
    }
    if (written.order.state === 'delivered') {
        await emitOrderEvent(deps, { cityId, now: writer.now }, written, { kind: 'order.delivered' });
    }
    return { scene: written, outcome };
}

/** The watch: asks USGS about the orders of `scenes` in one session and records every answer (each order still in the state it was read in). */
export async function checkOrders(deps: CheckDeps, cityId: string, scenes: readonly OrderedScene[]): Promise<void> {
    const now = deps.clock.now();
    for (const [scene, outcome] of await ask(deps, scenes, now)) {
        await record(deps, { cityId, writer: { by: IMAGERY_WRITER, now } }, scene, outcome);
    }
    deps.log.info('usgs orders checked', { cityId, asked: scenes.length });
}

/** Who asks "Check now" about which scene; `forced` skips USGS (DDS e-mail confirm). */
export interface CheckOneAsk {
    readonly cityId: string;
    readonly scene: OrderedScene;
    readonly by: string;
    readonly forced?: CheckOutcome;
}

/** "Check now": USGS asked about one order (one session), the answer recorded as the watch records it. */
export async function checkOne(deps: CheckDeps, ask: CheckOneAsk): Promise<Checked> {
    const { cityId, scene, by, forced } = ask;
    const now = deps.clock.now();
    if (forced !== undefined) {
        return record(deps, { cityId, writer: { by, now } }, scene, forced);
    }
    let outcome: CheckOutcome;
    try {
        const options = await withUsgs(deps, (apiKey) => deps.scenes.downloadOptions(apiKey, scene.dataset, [scene.entityId]));
        outcome = answerOf(options, scene);
    } catch (error) {
        await noteUsgsRefusal(deps, error, now);
        outcome = failedWith(error);
    }
    return record(deps, { cityId, writer: { by, now } }, scene, outcome);
}
