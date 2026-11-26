import '../global-options.js';

import {
    FIRESTORE_PATHS,
    MAPBOX_FREE_COMPUTE_UNITS,
    MAX_TILESETS,
    guardVerdict,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    nextMonthStart,
    tilesetIdFor,
    tilesetName,
    timestampFromDate,
    timestampToDate,
    usageDocSchema,
    usageMonth,
    type CallableRequest,
    type CallableResponse,
    type LayerVersionDoc,
    type PublishChoice,
    type UsageDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { finalizeVersion } from './finalize.js';
import { enqueuePublish } from './publish-queue.js';
import { countersOf, requireMapboxUser, requireTilesToken, requireVersion, stampOf, type Stamp } from './records.js';

/**
 * The ways out of a publish that does not fit the month (`docs/research/M3-interfaces.md` §7.2 step 3, §7.5; S-A42-*):
 * `imagery.choose` records the admin's choice: the free Mapbox Studio upload (the card then shows its three steps),
 * the first day of next month (the tick publishes it then, after the guard again), or paying the overage (App Check
 * consume; never at the tileset cap), which adds the overage to the month and reserves the estimate in one transaction.
 * At the tileset cap waiting a month cannot help (the cap counts tilesets, not units), and a file Mapbox refused as too
 * large has only the Studio way. `imagery.studioDone` finds the tileset the admin uploaded in Studio by its name and
 * points the layer at it: never the layer's own current tileset, and never one created before the choice (CR-M3-47:
 * otherwise a layer published through MTS would "find" its own old tiles without any upload).
 */
export type ChooseDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'tasks'>;
export type StudioDoneDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'secrets' | 'setup' | 'tilesets'>;

type ChooseRequest = CallableRequest<'imagery.choose'>;
type ChooseResponse = CallableResponse<'imagery.choose'>;
type Guard = NonNullable<LayerVersionDoc['guard']>;

/** A version that waits for a choice: approved, with a guard that did not let it through. */
type Waiting = LayerVersionDoc & { readonly guard: Guard };

function waitsForChoice(version: LayerVersionDoc | undefined): version is Waiting {
    return version?.state === 'approved' && version.guard !== undefined && version.guard.verdict !== 'within';
}

/** The guard after the admin's choice. */
function chosen(version: Waiting, choice: PublishChoice, stamp: Stamp, deferUntil?: Date): LayerVersionDoc {
    const deferral = deferUntil === undefined ? {} : { deferUntil: timestampFromDate(deferUntil) };
    const guard: Guard = { ...version.guard, choice, chosenBy: stamp.updatedBy, chosenAt: stamp.updatedAt, ...deferral };
    return { ...version, guard, ...stamp };
}

/** Pay: the overage joins the month and the estimate is reserved, so the publish fits when the guard runs again. */
function paid(usage: UsageDoc | undefined, version: Waiting, stamp: Stamp, month: string): UsageDoc {
    const counters = usage ?? {
        month,
        computeUnits: 0,
        computeUnitBudget: MAPBOX_FREE_COMPUTE_UNITS,
        uploadedMb: 0,
        publishes: 0,
        ...stamp,
    };
    const estimate = version.estimate?.computeUnits ?? 0;
    const outcome = guardVerdict({ estimate, usage: countersOf(counters), tilesets: 0, versionId: version.jobId });
    const overage = Math.max(0, estimate - outcome.available);
    const reservations = { ...counters.reservations, [version.jobId]: { computeUnits: estimate, at: stamp.updatedAt } };
    return { ...counters, overageComputeUnits: (counters.overageComputeUnits ?? 0) + overage, reservations, ...stamp };
}

interface Choosing {
    readonly request: ChooseRequest;
    readonly by: string;
    readonly now: Date;
}

/** The choices each verdict leaves: at the tileset cap only Studio (money and time do not free a place), too large only Studio. */
const CHOICES: Readonly<Record<Exclude<Guard['verdict'], 'within'>, readonly PublishChoice[]>> = {
    over: ['studio', 'defer', 'pay'],
    'tileset-limit': ['studio'],
    'too-large': ['studio'],
    // M5 (docs/research/M5-interfaces.md §1.8): over the city's share, paying the project's overage would not help.
    'city-over': ['studio', 'defer'],
};

/** A version waiting for this choice; paying or waiting is refused at the tileset cap (that needs the owner). */
function requireChoosable(version: LayerVersionDoc | undefined, choice: PublishChoice): Waiting {
    if (!waitsForChoice(version)) {
        throw new ApiError(version === undefined ? 'apiError.notFound' : 'apiError.imagery.versionState');
    }
    refuseChoice(version.guard.verdict as Exclude<Guard['verdict'], 'within'>, choice);
    return version;
}

/** A choice the verdict leaves no room for: past the tileset cap (that needs the owner), or one of no use. */
function refuseChoice(verdict: Exclude<Guard['verdict'], 'within'>, choice: PublishChoice): void {
    if (verdict === 'tileset-limit' && choice !== 'studio') {
        throw new ApiError('apiError.imagery.tilesetLimit', { limit: String(MAX_TILESETS) });
    }
    if (!CHOICES[verdict].includes(choice)) {
        throw new ApiError('apiError.imagery.versionState');
    }
}

async function chooseIn(transaction: DocumentTransaction, choosing: Choosing): Promise<LayerVersionDoc> {
    const { request, now } = choosing;
    const path = FIRESTORE_PATHS.layerVersion(request.cityId, request.versionId);
    const usagePath = FIRESTORE_PATHS.usage(usageMonth(now));
    const found = await transaction.get(path, layerVersionDocSchema);
    const usage = await transaction.get(usagePath, usageDocSchema);
    const version = requireChoosable(found, request.choice);
    const stamp = stampOf(choosing.by, now);
    if (request.choice === 'pay') {
        await transaction.set(usagePath, usageDocSchema, paid(usage, version, stamp, usageMonth(now)));
    }
    const result = chosen(version, request.choice, stamp, request.choice === 'defer' ? nextMonthStart(now) : undefined);
    await transaction.set(path, layerVersionDocSchema, result);
    return result;
}

/** A deferred publish: its job shows why it waits. */
async function markDeferred(deps: ChooseDeps, cityId: string, jobId: string, by: string): Promise<void> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    const job = await deps.documents.get(path, jobDocSchema);
    if (job !== undefined) {
        await deps.documents.set(path, jobDocSchema, { ...job, waitReason: 'deferred', ...stampOf(by, deps.clock.now()) });
    }
}

/** What happens after the choice: Pay publishes now, Defer waits for the month, Studio waits for the admin's upload. */
async function followUp(deps: ChooseDeps, request: ChooseRequest, version: LayerVersionDoc, by: string): Promise<ChooseResponse> {
    if (request.choice === 'pay') {
        await enqueuePublish(deps.tasks, { cityId: request.cityId, jobId: version.jobId }, 'paid');
        return { state: version.state };
    }
    if (request.choice === 'defer') {
        await markDeferred(deps, request.cityId, version.jobId, by);
        return { state: version.state, deferUntil: nextMonthStart(deps.clock.now()).toISOString() };
    }
    const studioPath = version.output?.studioPath;
    return studioPath === undefined ? { state: version.state } : { state: version.state, studioPath };
}

async function imageryChoose(deps: ChooseDeps, caller: VerifiedCaller, request: ChooseRequest): Promise<ChooseResponse> {
    const version = await deps.documents.transaction((transaction) =>
        chooseIn(transaction, { request, by: caller.uid, now: deps.clock.now() }),
    );
    deps.log.info('publish choice made', { uid: caller.uid, cityId: request.cityId, versionId: request.versionId, choice: request.choice });
    return followUp(deps, request, version, caller.uid);
}

/** The version waits for the admin's Studio upload. */
async function requireStudioChoice(deps: StudioDoneDeps, request: CallableRequest<'imagery.studioDone'>): Promise<LayerVersionDoc> {
    const version = await requireVersion(deps.documents, request.cityId, request.versionId);
    if (version.state !== 'approved' || version.guard?.choice !== 'studio') {
        throw new ApiError('apiError.imagery.versionState');
    }
    return version;
}

type Listed = Awaited<ReturnType<StudioDoneDeps['tilesets']['listTilesets']>>[number];

/** Uploaded after the choice: a tileset Mapbox says it created earlier is an old one (a listing without dates passes). */
function createdSince(tileset: Listed, chosenAt: Date | undefined): boolean {
    const created = tileset.created === undefined ? Number.NaN : Date.parse(tileset.created);
    return chosenAt === undefined || Number.isNaN(created) || created >= chosenAt.getTime();
}

/** The tileset the admin uploaded in Studio for the version: by its name, new since the choice, not the layer's own. */
/** When the admin chose the Studio way, when recorded. */
function chosenAtOf(version: LayerVersionDoc): Date | undefined {
    const chosenAt = version.guard?.chosenAt;
    return chosenAt === undefined ? undefined : timestampToDate(chosenAt);
}

/** The layer's own tileset now (its MTS one, say), which an upload in Studio is not. */
async function currentTileset(deps: StudioDoneDeps, cityId: string, layerId: string): Promise<string | undefined> {
    return (await deps.documents.get(FIRESTORE_PATHS.layer(cityId, layerId), layerDocSchema))?.mapbox?.tilesetId;
}

async function studioTileset(deps: StudioDoneDeps, request: CallableRequest<'imagery.studioDone'>, version: LayerVersionDoc) {
    const [user, token] = [await requireMapboxUser(deps.setup), await requireTilesToken(deps.secrets)];
    const current = await currentTileset(deps, request.cityId, version.layerId);
    const name = tilesetName(request.cityId, version.layerId);
    const chosenAt = chosenAtOf(version);
    const named = (tileset: Listed) => tileset.name === name || tileset.id === tilesetIdFor(user, request.cityId, version.layerId);
    const tilesets = await deps.tilesets.listTilesets(user, token, 100);
    const found = tilesets.find((tileset) => named(tileset) && tileset.id !== current && createdSince(tileset, chosenAt));
    if (found === undefined) {
        throw new ApiError('apiError.imagery.studioNotFound');
    }
    return found;
}

async function imageryStudioDone(
    deps: StudioDoneDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'imagery.studioDone'>,
): Promise<CallableResponse<'imagery.studioDone'>> {
    const version = await requireStudioChoice(deps, request);
    const found = await studioTileset(deps, request, version);
    await finalizeVersion(deps, {
        cityId: request.cityId,
        jobId: version.jobId,
        versionId: request.versionId,
        origin: 'studio',
        tilesetId: found.id,
    });
    deps.log.info('studio tileset linked', { uid: caller.uid, cityId: request.cityId, versionId: request.versionId, tilesetId: found.id });
    return { tilesetId: found.id, layerId: version.layerId };
}

/** The `imagery-choose` callable (App Check consume: paying is a spend). */
export function chooseFunction(getDeps: () => ChooseDeps & CallableDeps) {
    return defineCallable('imagery.choose', imageryChoose, getDeps);
}

/** The `imagery-studioDone` callable. */
export function studioDoneFunction(getDeps: () => StudioDoneDeps & CallableDeps) {
    return defineCallable('imagery.studioDone', imageryStudioDone, getDeps);
}
