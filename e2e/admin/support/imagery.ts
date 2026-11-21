import {
    CLOUD_RUN_JOBS,
    DEFAULT_RMSE_THRESHOLD_M,
    layerVersionDocSchema,
    PIPELINE_RUN_ARGS,
    RASTER_PATHS,
    SENSOR_SPECS,
    usgsSceneDocSchema,
    type CityImagery,
    type Sensor,
} from '@hcm/shared';
import { browseJpeg, catalogueScene, GOOGLE_TOKENS, type CatalogueScene } from '@hcm/test-support/fakes';
import type { APIRequestContext, APIResponse } from '@playwright/test';

import { E2E_TOKEN, MOCK_API_ORIGIN } from '../../fixtures/world.js';
import { ADMIN_WEB_CONFIG, E2E_PROJECT_ID, emulatorOrigin } from '../world.js';
import type { CityWorld } from './content.js';
import { FUNCTIONS_TIMEOUT_MS } from './emulators.js';
import { E2E_CITY_BOUNDS, type Bounds, type LatLng } from './imagery-geometry.js';
import type { ImageryScript, RunRecord } from './imagery-runner.js';
import type { UpstreamControl } from './upstream.js';

/**
 * The M3 imagery world of the e2e admin tier (docs/research/M3-interfaces.md §13): the server's side made ready (the
 * fake upstreams' `imagery.ready`: the USGS and Mapbox secrets and both pipeline jobs; `setup/status` with USGS and Mapbox
 * green; the budget guard green; the city's imagery settings), the raster pipeline runner scripted per city, scenes,
 * browse copies, versions and jobs seeded as the harvest, the callables and the pipeline would leave them, and
 * `imagery.tick` run on demand. `setup/status`, `ops/guard` and the server's upstream world are singletons: a spec that
 * makes the world ready is a locked spec (`ADMIN_LOCK`). Everything is written past the rules, as the server does.
 */

/** The Mapbox account of the fake MTS (`MAPBOX_TOKENS.tiles` is its tiles token). */
export const IMAGERY_MAPBOX_USER = 'e2e-mapbox';

/** The years the Bucharest import gives the city (CR-M3-8): the five target frames of the fake USGS. */
const BUCHAREST_TARGET_YEARS: readonly number[] = [1966, 1976, 1977, 1978, 1980];

/** The emulators' administrator credential. */
const OWNER = { authorization: 'Bearer owner' } as const;

async function ok(response: APIResponse, what: string): Promise<APIResponse> {
    if (!response.ok()) {
        throw new Error(`${what}: ${String(response.status())} ${await response.text()}`);
    }
    return response;
}

/** The share of `bounds` a footprint's box covers (the equal-area approximation of §3.2 on boxes). */
function coverageOf(footprint: readonly LatLng[], bounds: Bounds): number {
    const lats = footprint.map((place) => place.lat);
    const lngs = footprint.map((place) => place.lng);
    const width = Math.max(0, Math.min(bounds.east, Math.max(...lngs)) - Math.max(bounds.west, Math.min(...lngs)));
    const height = Math.max(0, Math.min(bounds.north, Math.max(...lats)) - Math.max(bounds.south, Math.min(...lats)));
    return Math.round(((width * height) / ((bounds.east - bounds.west) * (bounds.north - bounds.south))) * 100) / 100;
}

function metadataOf(scene: CatalogueScene): Readonly<Record<string, string>> {
    return Object.fromEntries(
        (scene.result.metadata as { fieldName: string; value: string }[]).map((field) => [field.fieldName, field.value]),
    );
}

function cornersOf(fields: Readonly<Record<string, string>>): Record<string, LatLng> | undefined {
    const corner = (name: string): LatLng | undefined => {
        const lat = fields[`${name} Corner Lat dec`];
        const lng = fields[`${name} Corner Long dec`];
        return lat === undefined || lng === undefined ? undefined : { lat: Number(lat), lng: Number(lng) };
    };
    const [nw, ne, se, sw] = ['NW', 'NE', 'SE', 'SW'].map(corner);
    return nw === undefined || ne === undefined || se === undefined || sw === undefined ? undefined : { nw, ne, se, sw };
}

/**
 * A `usgsScenes` document of a catalogue scene as the harvest writes it (§3.2): the footprint, corners, cloud, resolution,
 * coverage of `bounds`; the rank is the spec's (the ranking itself is `rankScene` of `@hcm/shared`, fn-imagery's).
 */
function sceneDocument(
    entityId: string,
    at: Date,
    extra: Readonly<Record<string, unknown>> = {},
    bounds: Bounds = E2E_CITY_BOUNDS,
): Record<string, unknown> {
    const scene = catalogueScene(entityId);
    if (scene === undefined) {
        throw new Error(`the fake USGS has no scene ${entityId}`);
    }
    const fields = metadataOf(scene);
    const sensor = fields['Camera Type'] as Sensor;
    const ring =
        (scene.result as unknown as { spatialCoverage: { coordinates: [number, number][][] } }).spatialCoverage.coordinates[0] ?? [];
    const footprint = ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
    const cloud = Number((scene.result as unknown as { cloudCover: string }).cloudCover);
    const corners = cornersOf(fields);
    return {
        entityId,
        displayId: scene.result.displayId,
        dataset: scene.dataset,
        sensor,
        acquisitionDate: scene.result.temporalCoverage.startDate.slice(0, 10),
        status: 'candidate',
        downloadAvailable: scene.result.options.download,
        footprint,
        ...(corners === undefined ? {} : { corners }),
        ...(cloud < 0 ? {} : { cloudCover: cloud }),
        resolutionM: SENSOR_SPECS[sensor].resolutionM,
        coverage: coverageOf(footprint, bounds),
        browse: { state: 'none', sourceUrl: scene.result.browse[0]?.browsePath },
        rank: { score: 50, reasons: [], version: 1 },
        harvestedAt: at,
        updatedBy: 'system:imagery',
        updatedAt: at,
        ...extra,
    };
}

export class ImageryWorld {
    readonly #api: APIRequestContext;
    readonly #world: CityWorld;
    readonly #upstream: UpstreamControl;

    constructor(api: APIRequestContext, world: CityWorld, upstream: UpstreamControl) {
        this.#api = api;
        this.#world = world;
        this.#upstream = upstream;
    }

    get city(): string {
        return this.#world.city;
    }

    /** The city the world writes into (for the seed helpers and the manifest's flows). */
    get cityWorld(): CityWorld {
        return this.#world;
    }

    #path(below: string): string {
        return `cities/${this.#world.city}/${below}`;
    }

    /**
     * The server's side ready to harvest, import and publish (a locked spec: it writes `setup/status`, `ops/guard` and the
     * server's upstream world): USGS approved with downloads, Mapbox green with the fake MTS account and the admin's map
     * token (the e2e token the mock Mapbox accepts), the guard green, the city's imagery settings (`settings`, else the
     * defaults with Bucharest's target years).
     */
    async ready(at: Date, settings: CityImagery = {}): Promise<void> {
        await this.#upstream.scenario('imagery.ready', 'server');
        const { emulators } = this.#world;
        await emulators.setDocument('setup/status', {
            usgs: { state: 'ok', role: 'download', checkedAt: at },
            mapbox: { state: 'ok', user: IMAGERY_MAPBOX_USER, adminToken: E2E_TOKEN, checkedAt: at },
            updatedBy: 'system:setup',
            updatedAt: at,
        });
        await emulators.setDocument('ops/guard', { state: 'green', updatedBy: 'system:ops', updatedAt: at });
        const imagery = {
            autoPublish: true,
            // The specs of this world drive Mapbox's path behind its mock; M12's own tiles seed the default.
            publishThroughMapbox: true,
            rmseThresholdM: DEFAULT_RMSE_THRESHOLD_M,
            targetYears: [...BUCHAREST_TARGET_YEARS],
            ...settings,
        };
        await emulators.updateFields(`cities/${this.#world.city}`, { imagery }, ['imagery']);
    }

    /** Scripts the raster pipeline runs of this city (the stand-in by default; `python` for the real pipeline). */
    async script(script: ImageryScript): Promise<void> {
        await ok(await this.#api.post(this.#control('script'), { data: script }), 'imagery script');
    }

    /** Lets the city's runs held at their `holdAt` step go on; how many were held. */
    async release(): Promise<number> {
        const response = await ok(await this.#api.post(this.#control('release')), 'imagery release');
        return ((await response.json()) as { released: number }).released;
    }

    /** The runs the runner played for this city, oldest first. */
    async runs(): Promise<RunRecord[]> {
        return (await (await ok(await this.#api.get(this.#control('runs')), 'imagery runs')).json()) as RunRecord[];
    }

    /** Forgets this city's script and runs. */
    async resetRunner(): Promise<void> {
        await ok(await this.#api.post(this.#control('reset')), 'imagery reset');
    }

    /**
     * The server's world answers the synthetic scene written to `dir` (a folder under `reports/`, relative to the
     * repository) by `pipeline/tests/synthetic/scenes.py`: the 1966 frame's delivery, its Sentinel-2 window, its lines.
     */
    async useSyntheticScene(dir: string): Promise<void> {
        const url = `${MOCK_API_ORIGIN}/__imagery/synthetic?dir=${encodeURIComponent(dir)}`;
        await ok(await this.#api.post(url), 'synthetic scene');
    }

    /** USGS answers these frames of a date's set as scanned, though its catalogue does not list them (M8). */
    async scannedFrames(entityIds: readonly string[]): Promise<void> {
        const url = `${MOCK_API_ORIGIN}/__imagery/frames?ids=${encodeURIComponent(entityIds.join(','))}`;
        await ok(await this.#api.post(url), 'scanned frames');
    }

    #control(action: string): string {
        return `${MOCK_API_ORIGIN}/__imagery/${action}?city=${encodeURIComponent(this.#world.city)}`;
    }

    /** A harvested scene (`sceneDocument`), validated with the shared schema. */
    async seedScene(entityId: string, at: Date, extra: Readonly<Record<string, unknown>> = {}): Promise<void> {
        const document = sceneDocument(entityId, at, extra);
        usgsSceneDocSchema.parse({ ...document, harvestedAt: { seconds: 0, nanoseconds: 0 }, updatedAt: { seconds: 0, nanoseconds: 0 } });
        await this.#world.emulators.setDocument(this.#path(`usgsScenes/${entityId}`), document);
    }

    /** The scene's browse copy in the private bucket, as `imagery.browse` leaves it (the JPEG of the fake browse host). */
    async seedBrowse(entityId: string, at: Date): Promise<string> {
        const scene = catalogueScene(entityId);
        const path = RASTER_PATHS.browse(String(scene?.dataset), entityId);
        await this.upload(path, browseJpeg(), 'image/jpeg');
        const sourceUrl = scene?.result.browse[0]?.browsePath;
        const browse = { state: 'copied', path, checkedAt: at, ...(sourceUrl === undefined ? {} : { sourceUrl }) };
        await this.#world.emulators.updateFields(this.#path(`usgsScenes/${entityId}`), { browse }, ['browse']);
        return path;
    }

    /** An object of the private bucket, uploaded past the rules. */
    async upload(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
        const query = new URLSearchParams({ uploadType: 'media', name: path });
        const url = `${emulatorOrigin('storage')}/upload/storage/v1/b/${ADMIN_WEB_CONFIG.storageBucket}/o?${query.toString()}`;
        await ok(
            await this.#api.post(url, { headers: { ...OWNER, 'content-type': contentType }, data: Buffer.from(bytes) }),
            `upload of ${path}`,
        );
    }

    /** A layer version (`layerVersionDocSchema`), validated first. */
    async seedVersion(versionId: string, fields: Readonly<Record<string, unknown>>, at: Date): Promise<void> {
        const document = {
            jobId: versionId,
            createdBy: 'system:imagery',
            createdAt: at,
            updatedBy: 'system:imagery',
            updatedAt: at,
            ...fields,
        };
        const stamp = { seconds: Math.floor(at.getTime() / 1000), nanoseconds: 0 };
        layerVersionDocSchema.parse({ ...document, createdAt: stamp, updatedAt: stamp });
        await this.#world.emulators.setDocument(this.#path(`layerVersions/${versionId}`), document);
    }

    /** A job of the city as the callables and the dispatcher keep it. */
    async seedJob(jobId: string, fields: Readonly<Record<string, unknown>>, at: Date): Promise<void> {
        await this.#world.emulators.setDocument(this.#path(`jobs/${jobId}`), {
            params: {},
            createdBy: 'system:imagery',
            createdAt: at,
            updatedBy: 'system:imagery',
            updatedAt: at,
            ...fields,
        });
    }

    /** A job's document, or undefined. */
    job(jobId: string): Promise<Record<string, unknown> | undefined> {
        return this.#world.emulators.document(this.#path(`jobs/${jobId}`));
    }

    /** A version's document, or undefined. */
    version(versionId: string): Promise<Record<string, unknown> | undefined> {
        return this.#world.emulators.document(this.#path(`layerVersions/${versionId}`));
    }

    /** A job's log lines, by id. */
    logs(jobId: string): Promise<Record<string, Record<string, unknown>>> {
        return this.#world.emulators.collection(this.#path(`jobs/${jobId}/logs`));
    }

    /** The private bucket's objects below `prefix`, sorted. */
    objects(prefix: string): Promise<string[]> {
        return this.#world.emulators.objectNames(prefix);
    }

    /**
     * Starts the job's Cloud Run execution as the dispatcher does (§4.2; the harness, before fn-imagery's dispatcher): the
     * job `starting`, then `jobs:run` on the fake Cloud Run of the server's world, then the execution's name on the job.
     */
    async dispatch(jobId: string, machine: keyof typeof CLOUD_RUN_JOBS = 'std', attempt = 1): Promise<string> {
        const path = this.#path(`jobs/${jobId}`);
        await this.#world.emulators.updateFields(path, { status: 'starting', machine, attempt }, ['status', 'machine', 'attempt']);
        const url = `${MOCK_API_ORIGIN}/h/run.googleapis.com/v2/projects/${E2E_PROJECT_ID}/locations/us-central1/jobs/${CLOUD_RUN_JOBS[machine]}:run`;
        const env = [
            { name: 'JOB_ID', value: jobId },
            { name: 'CITY_ID', value: this.#world.city },
        ];
        const response = await ok(
            await this.#api.post(url, {
                headers: { authorization: `Bearer ${GOOGLE_TOKENS.owner}` },
                data: { overrides: { containerOverrides: [{ env, args: [...PIPELINE_RUN_ARGS] }], taskCount: 1 } },
            }),
            `run of ${jobId}`,
        );
        const name = ((await response.json()) as { metadata: { name: string } }).metadata.name;
        await this.#world.emulators.updateFields(path, { executionName: name }, ['executionName']);
        return name;
    }

    /** The state of an execution on the fake Cloud Run (`running`, `succeeded`, ...), from its counts. */
    async execution(name: string): Promise<string> {
        const response = await ok(
            await this.#api.get(`${MOCK_API_ORIGIN}/h/run.googleapis.com/v2/${name}`, {
                headers: { authorization: `Bearer ${GOOGLE_TOKENS.owner}` },
            }),
            `execution ${name}`,
        );
        const body = (await response.json()) as Record<string, unknown>;
        const counts = ['succeededCount', 'failedCount', 'cancelledCount'] as const;
        const ended = counts.find((count) => Number(body[count] ?? 0) > 0);
        return ended === undefined ? 'running' : ended.replace('Count', '');
    }

    /** Cancels an execution on the fake Cloud Run, as the dispatcher does after the admin's Cancel. */
    async cancelExecution(name: string): Promise<void> {
        await ok(
            await this.#api.post(`${MOCK_API_ORIGIN}/h/run.googleapis.com/v2/${name}:cancel`, {
                headers: { authorization: `Bearer ${GOOGLE_TOKENS.owner}` },
                data: {},
            }),
            `cancel of ${name}`,
        );
    }

    /**
     * Runs `imagery.tick` once, as Cloud Scheduler would (the Functions emulator cannot trigger a scheduled v2 function from
     * its topic; its trigger route takes the event): dispatch, resume, Mapbox polls, deferred publishes, deletions. It walks
     * every city of the emulators, the content worlds' too (kept by the reset), so late in a run it takes tens of seconds.
     */
    async tick(): Promise<void> {
        const trigger = `${emulatorOrigin('functions')}/functions/projects/${E2E_PROJECT_ID}/triggers/us-central1-imagery-tick-0`;
        await ok(
            await this.#api.post(trigger, {
                headers: { 'content-type': 'application/cloudevents+json; charset=UTF-8' },
                data: {
                    specversion: '1.0',
                    id: 'e2e-imagery-tick',
                    source: 'e2e',
                    type: 'google.cloud.scheduler.job.v1.executed',
                    data: {},
                },
                timeout: FUNCTIONS_TIMEOUT_MS,
            }),
            'imagery.tick (restart the emulators if the functions were reloaded)',
        );
    }
}
