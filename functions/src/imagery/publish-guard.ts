/**
 * The compute-unit guard (`docs/research/M3-interfaces.md` §7.2; security review §3.3; S-A42-*): before anything reaches
 * Mapbox, one transaction on `usage/mapbox-YYYY-MM` checks the version's estimate against what the month has left (the
 * budget plus any paid overage, minus what is spent and what other publishes hold) and the account's tileset count.
 * Within: the estimate is reserved and the job moves to `mts_processing`. Over, or at the tileset cap: the version
 * records the verdict and the job waits for the admin's choice. Two approvals at once never both fit the last units:
 * the reservations are in the same transaction (`S-A42-BAD-RACING-PUBLISHES`). The tileset count (CR-M3-47) holds every
 * tileset the account has or is about to have: the layers' tilesets, those of deleted layers still in their grace, the
 * first publishes under way (a version `publishing` for a layer without a tileset) and, read in the same transaction, the
 * reservations of first publishes, so two first publishes at once never both take the last place
 * (`S-A42-BAD-RACING-TILESETS`). M5 (`docs/research/M5-interfaces.md` §1.8; S-A52-BAD-CITY-OVER): a city with limits is
 * also held by its share of the month (`cities/{city}/usage/{month}`, in the same transaction): over it, the version
 * waits with the verdict `city-over` while the other cities' publishes go on. M7 (`docs/research/M7-local-worker.md` §6):
 * the same transaction first chooses the way to Mapbox (`publish-path.ts`); the free Uploads API path reserves nothing.
 */
import {
    FIRESTORE_PATHS,
    MAPBOX_FREE_COMPUTE_UNITS,
    cityComputeUnitsAvailable,
    cityDocSchema,
    guardVerdict,
    jobDocSchema,
    layerDeleteParamsSchema,
    layerDocSchema,
    layerVersionDocSchema,
    timestampFromDate,
    timestampToDate,
    usageDocSchema,
    usageMonth,
    validate,
    type CityUsageDoc,
    type GuardOutcome,
    type JobDoc,
    type LayerDoc,
    type LayerVersionDoc,
    type UsageDoc,
} from '@hcm/shared';

import { readCityUsage, shareOf, writeCityUsage, type CityShare } from '../api/city-usage.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { estimateOf } from './approval.js';
import { cityIds } from './limits.js';
import { publishPathOf, takeUploads } from './publish-path.js';
import { IMAGERY_WRITER, countersOf, pickDefined, stampOf, versionIdOf, withStep } from './records.js';

export type GuardDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/** `publish`: go on to Mapbox; `wait`: the version waits (a choice, a deferral, the tileset cap); `skip`: nothing to do. */
export type GuardStep = 'publish' | 'wait' | 'skip';

type Guard = NonNullable<LayerVersionDoc['guard']>;

/** The version the guard runs for, and its layer. */
export interface GuardSubject {
    readonly id: string;
    readonly layerId: string;
}

/** What the guard knows of the account's tilesets before its transaction. */
interface Tilesets {
    /** Tilesets that exist (the layers', the version's own left out) or wait for their deletion. */
    readonly existing: number;
    /** First publishes under way elsewhere: versions `publishing` for a layer without a tileset, by version id. */
    readonly firstPublishes: ReadonlySet<string>;
    /** The version's own layer has a tileset already: its publish makes none. */
    readonly ownHasTileset: boolean;
}

interface CityTilesets {
    readonly existing: number;
    readonly firstPublishes: readonly string[];
    readonly ownHasTileset: boolean;
}

/** Queued `layer-delete` jobs whose tileset still exists until their grace ends. */
async function deletionsWithTileset(deps: GuardDeps, cityId: string): Promise<number> {
    const jobs = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['type', '==', 'layer-delete']] });
    return jobs.documents.filter((job) => {
        const params = validate(layerDeleteParamsSchema, job.data.params);
        return job.data.status === 'queued' && params.ok && params.value.tilesetId !== undefined;
    }).length;
}

/** One city's share: its layers' tilesets, its pending deletions, and its first publishes under way. */
async function cityTilesets(deps: GuardDeps, cityId: string, subject: GuardSubject & { readonly cityId: string }): Promise<CityTilesets> {
    const layers = await deps.documents.query(FIRESTORE_PATHS.layers(cityId), layerDocSchema);
    const withTileset = new Set(layers.documents.filter((layer) => layer.data.mapbox?.tilesetId !== undefined).map((layer) => layer.id));
    const ownHere = cityId === subject.cityId && withTileset.has(subject.layerId);
    const publishing = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['state', '==', 'publishing']],
    });
    const firstPublishes = publishing.documents
        .filter((version) => !withTileset.has(version.data.layerId) && version.id !== subject.id)
        .map((version) => version.id);
    return {
        existing: withTileset.size - Number(ownHere) + (await deletionsWithTileset(deps, cityId)),
        firstPublishes,
        ownHasTileset: ownHere,
    };
}

/** The account's tilesets as the cap counts them, over every city of the project. */
async function tilesetsOf(deps: GuardDeps, cityId: string, subject: GuardSubject): Promise<Tilesets> {
    const cities = await Promise.all((await cityIds(deps.documents)).map((id) => cityTilesets(deps, id, { ...subject, cityId })));
    return {
        existing: cities.reduce((sum, city) => sum + city.existing, 0),
        firstPublishes: new Set(cities.flatMap((city) => city.firstPublishes)),
        ownHasTileset: cities.some((city) => city.ownHasTileset),
    };
}

/** The count the cap compares: what exists, the first publishes under way, and the reservations of first publishes. */
function tilesetCount(tilesets: Tilesets, usage: UsageDoc, versionId: string): number {
    const reserved = Object.entries(usage.reservations ?? {}).filter(
        ([id, held]) => held.newTileset === true && id !== versionId && !tilesets.firstPublishes.has(id),
    );
    return tilesets.existing + tilesets.firstPublishes.size + reserved.length;
}

/** A month's counter as it starts: nothing spent, the free compute units as its budget. */
function emptyUsage(month: string, now: Date): UsageDoc {
    return {
        month,
        computeUnits: 0,
        computeUnitBudget: MAPBOX_FREE_COMPUTE_UNITS,
        uploadedMb: 0,
        publishes: 0,
        ...stampOf(IMAGERY_WRITER, now),
    };
}

interface Paths {
    readonly job: string;
    readonly version: string;
    readonly usage: string;
}

/** M5: the version's city's share and its month's counters, when the city has limits. */
interface CityAccount {
    readonly share: CityShare;
    readonly usage: CityUsageDoc;
}

interface Loaded {
    readonly job: JobDoc | undefined;
    readonly version: LayerVersionDoc | undefined;
    /** M7: the version's layer (its tileset's origin decides whether the Uploads API may replace it). */
    readonly layer: LayerDoc | undefined;
    readonly versionId: string;
    readonly usage: UsageDoc;
    readonly city: CityAccount | undefined;
    readonly paths: Paths;
}

interface Checked {
    readonly job: JobDoc;
    readonly version: LayerVersionDoc;
    readonly layer: LayerDoc | undefined;
    readonly versionId: string;
    readonly estimate: number;
    readonly usage: UsageDoc;
    readonly city: CityAccount | undefined;
    readonly paths: Paths;
    /** The publish makes a tileset its layer does not have yet. */
    readonly newTileset: boolean;
}

async function load(transaction: DocumentTransaction, cityId: string, jobId: string, now: Date): Promise<Loaded> {
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    const versionId = versionIdOf(jobId, job ?? {});
    const paths = {
        job: FIRESTORE_PATHS.job(cityId, jobId),
        version: FIRESTORE_PATHS.layerVersion(cityId, versionId),
        usage: FIRESTORE_PATHS.usage(usageMonth(now)),
    };
    const version = await transaction.get(paths.version, layerVersionDocSchema);
    const layer = version === undefined ? undefined : await transaction.get(FIRESTORE_PATHS.layer(cityId, version.layerId), layerDocSchema);
    const usage = (await transaction.get(paths.usage, usageDocSchema)) ?? emptyUsage(usageMonth(now), now);
    return { job, version, layer, versionId, usage, city: await loadCity(transaction, cityId, now), paths };
}

/** M5 (`docs/research/M5-interfaces.md` §1.8): the city's share and counters, read in the guard's transaction. */
async function loadCity(transaction: DocumentTransaction, cityId: string, now: Date): Promise<CityAccount | undefined> {
    const city = await transaction.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    const share = city === undefined ? undefined : shareOf(cityId, city);
    return share === undefined ? undefined : { share, usage: await readCityUsage(transaction, share, usageMonth(now)) };
}

/** A deferral that has not come due yet. */
function deferred(guard: Guard | undefined, now: Date): boolean {
    const until = guard?.deferUntil;
    return until !== undefined && timestampToDate(until) > now;
}

/**
 * Why an approved version is held back: the admin chose Studio, deferred it to a later month, or Mapbox refused its file
 * as too large and the admin has not chosen the Studio way yet (another publish would only send the same file again).
 */
function heldBack(guard: Guard | undefined, now: Date): GuardStep | undefined {
    if (guard?.choice === 'studio') {
        return 'skip';
    }
    return waitsForAdmin(guard, now) ? 'wait' : undefined;
}

/** Deferred to a month that has not come, or refused as too large with no choice made yet. */
function waitsForAdmin(guard: Guard | undefined, now: Date): boolean {
    return deferred(guard, now) || guard?.verdict === 'too-large';
}

/** Where the publish stands before the guard: past it already, held back, nothing to publish, or to be checked. */
function stance(job: JobDoc, version: LayerVersionDoc, now: Date): GuardStep | 'check' {
    if (job.status === 'mts_processing' && version.state === 'publishing') {
        return 'publish';
    }
    if (version.state !== 'approved') {
        return 'skip';
    }
    return heldBack(version.guard, now) ?? 'check';
}

function estimateFor(
    version: LayerVersionDoc,
    output: NonNullable<LayerVersionDoc['output']>,
    now: Date,
): NonNullable<LayerVersionDoc['estimate']> {
    return version.estimate ?? estimateOf(output, now);
}

/** What to do without checking, or what the guard must check. */
type Next = { readonly step: GuardStep } | { readonly checked: Checked };

function checkable(loaded: Loaded, now: Date, newTileset: boolean): Next {
    const { job, version } = loaded;
    if (job === undefined || version?.output === undefined) {
        return { step: 'skip' };
    }
    const where = stance(job, version, now);
    if (where !== 'check') {
        return { step: where };
    }
    const estimate = estimateFor(version, version.output, now);
    return { checked: { ...loaded, job, version: { ...version, estimate }, estimate: estimate.computeUnits, newTileset } };
}

/** An admin's earlier choice is kept when the publish now fits (a paid overage); a new verdict asks for a new one. */
function keptChoice(outcome: GuardOutcome, guard: Guard | undefined): Partial<Guard> {
    return outcome.verdict === 'within' && guard !== undefined ? pickDefined(guard, ['choice', 'chosenBy', 'chosenAt']) : {};
}

function guardRecord(outcome: GuardOutcome, version: LayerVersionDoc, now: Date): Guard {
    const overage = outcome.verdict === 'over' ? { overageUsd: outcome.overageUsd } : {};
    return {
        verdict: outcome.verdict,
        available: outcome.available,
        ...overage,
        ...keptChoice(outcome, version.guard),
        checkedAt: timestampFromDate(now),
    };
}

/** Within: the reservation is taken, the version is `publishing`, the job `mts_processing`. */
async function reserve(transaction: DocumentTransaction, checked: Checked, outcome: GuardOutcome, now: Date): Promise<void> {
    const stamp = stampOf(IMAGERY_WRITER, now);
    const held = { computeUnits: checked.estimate, at: stamp.updatedAt, ...(checked.newTileset ? { newTileset: true } : {}) };
    const reservations = { ...checked.usage.reservations, [checked.versionId]: held };
    await transaction.set(checked.paths.usage, usageDocSchema, { ...checked.usage, reservations, ...stamp });
    await reserveForCity(transaction, checked, stamp);
    const version: LayerVersionDoc = {
        ...checked.version,
        state: 'publishing',
        guard: guardRecord(outcome, checked.version, now),
        ...stamp,
    };
    await transaction.set(checked.paths.version, layerVersionDocSchema, version);
    const job = withStep({ ...checked.job, status: 'mts_processing', waitReason: 'mapbox', ...stamp }, 'guard', 'done', stamp.updatedAt);
    await transaction.set(checked.paths.job, jobDocSchema, job);
}

/**
 * M5: the city's share holds the estimate as soon as the publish goes on (the project's counter keeps the exact spend); a
 * publish that fails later stays counted against the city until the month ends, which errs on the side of the budget.
 */
async function reserveForCity(transaction: DocumentTransaction, checked: Checked, stamp: ReturnType<typeof stampOf>): Promise<void> {
    if (checked.city === undefined) {
        return;
    }
    const { share, usage } = checked.city;
    const reservations = { ...usage.reservations, [checked.versionId]: { computeUnits: checked.estimate, at: stamp.updatedAt } };
    await writeCityUsage(transaction, share, { ...usage, reservations }, stamp);
}

/** Over the month, or at the tileset cap: the verdict is recorded and the job waits for the admin's choice. */
async function hold(transaction: DocumentTransaction, checked: Checked, outcome: GuardOutcome, now: Date): Promise<void> {
    const stamp = stampOf(IMAGERY_WRITER, now);
    const version: LayerVersionDoc = { ...checked.version, guard: guardRecord(outcome, checked.version, now), ...stamp };
    await transaction.set(checked.paths.version, layerVersionDocSchema, version);
    await transaction.set(checked.paths.job, jobDocSchema, { ...checked.job, waitReason: 'compute-units', ...stamp });
}

async function decide(transaction: DocumentTransaction, checked: Checked, tilesets: Tilesets, now: Date): Promise<GuardStep> {
    const outcome = guardVerdict({
        estimate: checked.estimate,
        usage: countersOf(checked.usage),
        tilesets: tilesetCount(tilesets, checked.usage, checked.versionId),
        versionId: checked.versionId,
        cityAvailable: cityComputeUnitsAvailable(checked.city?.share.limits, checked.city?.usage, checked.versionId),
    });
    if (outcome.verdict === 'within') {
        await reserve(transaction, checked, outcome, now);
        return 'publish';
    }
    await hold(transaction, checked, outcome, now);
    return 'wait';
}

/** Runs the guard for the job's version `subject`; what the publisher does next. */
export async function runGuard(deps: GuardDeps, cityId: string, jobId: string, subject: GuardSubject): Promise<GuardStep> {
    const tilesets = await tilesetsOf(deps, cityId, subject);
    const now = deps.clock.now();
    const step = await deps.documents.transaction(async (transaction) => {
        const next = checkable(await load(transaction, cityId, jobId, now), now, !tilesets.ownHasTileset);
        if ('step' in next) {
            return next.step;
        }
        const checked = next.checked;
        return publishPathOf(checked) === 'uploads'
            ? takeUploads(transaction, checked.paths, checked, now)
            : decide(transaction, checked, tilesets, now);
    });
    deps.log.info('compute-unit guard', { cityId, jobId, step, tilesets: tilesets.existing + tilesets.firstPublishes.size });
    return step;
}
