/**
 * Which frames of one date make its whole-city layer (`docs/research/M8-join-interfaces.md` §2): the city's bounds as a grid,
 * each frame as the grid cells it covers, then a greedy choice. Pure: the functions (`imagery/join-plan.ts`) write its rows
 * to `imageryPlans/dates`. The figures are estimates (`coverage.ts`: a panoramic model ring can sit about 7 km off), so
 * the admin words them "about" and the join page shows what the pipeline measured.
 */
import type { BoundsRecord } from '../geo/bbox.js';
import { roundTo } from '../geo/math.js';
import { DATE_PLAN_MAX_ROWS, type DatePlanRow } from '../schemas/imagery-plan.js';
import { JOIN_MAX_PARTS } from '../schemas/imagery-settings.js';
import type { LayerVersionState } from '../schemas/imagery.js';
import { CLOUDY_CITY_PERCENT, type Sensor, type UsgsSceneDoc } from '../schemas/usgs-scene.js';
import { coverageRing, type FootprintVertex } from './coverage.js';

/** What the plan reads of a frame: its scene, and its version once it was imported. */
export interface DatePlanFrame {
    readonly entityId: string;
    readonly displayId?: string;
    /** The scene's `acquisitionDate`. */
    readonly date: string;
    readonly sensor: Sensor;
    /** The scene's `downloadAvailable`: already scanned, no order needed. */
    readonly free: boolean;
    readonly footprint: readonly FootprintVertex[];
    readonly corners?: UsgsSceneDoc['corners'];
    readonly versionId?: string;
    readonly state?: LayerVersionState;
    /** The version's `output.bounds` when it rendered: what a crop kept. It is a box, nodata included, so never the outline alone. */
    readonly renderedBounds?: BoundsRecord;
    /** M9: the frame's edge over the city, measured (`calibration.outline`, else the render's `output.outline`), so it comes first. */
    readonly measuredOutline?: readonly FootprintVertex[];
    /** The share of the city its browse image shows clouded (`cloudEstimate.percent`), when measured. */
    readonly cloudPercent?: number;
}

/** A frame with the grid cells it covers. */
interface Candidate {
    readonly frame: DatePlanFrame;
    readonly cells: ReadonlySet<number>;
}

/** Cells per side of the grid over the city's bounds. */
const GRID_SIDE = 48;
/** The choice stops once this share of the city is covered, or the best frame left adds under {@link MIN_GAIN}. */
const REACH = 0.95;
const MIN_GAIN = 0.02;
const WINTER_MONTHS: ReadonlySet<string> = new Set(['12', '01', '02']);

function gridOf(bounds: BoundsRecord): FootprintVertex[] {
    const width = (bounds.east - bounds.west) / GRID_SIDE;
    const height = (bounds.north - bounds.south) / GRID_SIDE;
    return Array.from({ length: GRID_SIDE * GRID_SIDE }, (_cell, index) => ({
        lat: bounds.south + (Math.floor(index / GRID_SIDE) + 0.5) * height,
        lng: bounds.west + ((index % GRID_SIDE) + 0.5) * width,
    }));
}

/** Whether the ring's edge from `from` to `to` crosses the ray going east from `point`. */
function crossesRay(point: FootprintVertex, from: FootprintVertex, to: FootprintVertex): boolean {
    return (
        from.lat > point.lat !== to.lat > point.lat &&
        point.lng < from.lng + ((point.lat - from.lat) / (to.lat - from.lat)) * (to.lng - from.lng)
    );
}

/** Point in an open ring: an odd count of edges crossed. */
function insideRing(point: FootprintVertex, ring: readonly FootprintVertex[]): boolean {
    let inside = false;
    let previous = ring.at(-1);
    for (const vertex of ring) {
        inside = previous !== undefined && crossesRay(point, previous, vertex) ? !inside : inside;
        previous = vertex;
    }
    return inside;
}

function insideBounds(point: FootprintVertex, bounds: BoundsRecord): boolean {
    return point.lat >= bounds.south && point.lat <= bounds.north && point.lng >= bounds.west && point.lng <= bounds.east;
}

function cellsWhere(grid: readonly FootprintVertex[], covers: (point: FootprintVertex) => boolean): ReadonlySet<number> {
    return new Set(grid.flatMap((point, index) => (covers(point) ? [index] : [])));
}

/**
 * The cells a frame covers: inside the outline it was measured to have, else the one its coverage estimates, and, once it rendered, inside its output's box. The box alone
 * would count nodata: a tilted strip's box can hold the whole city while the frame holds half of it. A rendered frame whose
 * outline misses its own box has a useless outline, so the box places it.
 */
function cellsOf(frame: DatePlanFrame, grid: readonly FootprintVertex[], middleLng: number): ReadonlySet<number> {
    const outline = frame.measuredOutline ?? coverageRing(frame.footprint, frame, middleLng);
    const box = frame.renderedBounds;
    if (box === undefined) {
        return cellsWhere(grid, (point) => insideRing(point, outline));
    }
    const both = cellsWhere(grid, (point) => insideRing(point, outline) && insideBounds(point, box));
    return both.size > 0 ? both : cellsWhere(grid, (point) => insideBounds(point, box));
}

function candidateOf(frame: DatePlanFrame, grid: readonly FootprintVertex[], middleLng: number): Candidate {
    return { frame, cells: cellsOf(frame, grid, middleLng) };
}

function unionOf(candidates: readonly Candidate[]): ReadonlySet<number> {
    return new Set(candidates.flatMap((candidate) => [...candidate.cells]));
}

function gainOf(candidate: Candidate, covered: ReadonlySet<number>): number {
    return [...candidate.cells].filter((cell) => !covered.has(cell)).length;
}

/** The camera letter of an entity id (`D3C1202-200149F039`: `F`, the forward camera; `A`, the aft). */
function cameraOf(frame: DatePlanFrame): string | undefined {
    return /([A-Z])\d+$/.exec(frame.entityId)?.[1];
}

/** Largest first: the cells it adds, then free, then the camera of the frames chosen so far, then imported. */
function preference(candidate: Candidate, covered: ReadonlySet<number>, camera: string | undefined): readonly number[] {
    const { frame } = candidate;
    return [
        gainOf(candidate, covered),
        Number(frame.free),
        Number(camera !== undefined && cameraOf(frame) === camera),
        Number(frame.versionId !== undefined),
    ];
}

/** Largest first over two preference lists of one length; 0 when they tie. */
function compareLists(left: readonly number[], right: readonly number[]): number {
    const at = left.findIndex((value, index) => value !== right[index]);
    return at < 0 ? 0 : (right[at] ?? 0) - (left[at] ?? 0);
}

function bestOf(pool: readonly Candidate[], covered: ReadonlySet<number>, camera: string | undefined): Candidate | undefined {
    return pool
        .map((candidate) => ({ candidate, order: preference(candidate, covered, camera) }))
        .sort(
            (left, right) =>
                compareLists(left.order, right.order) || left.candidate.frame.entityId.localeCompare(right.candidate.frame.entityId),
        )
        .at(0)?.candidate;
}

function worthAdding(next: Candidate, covered: ReadonlySet<number>, chosen: number, total: number): boolean {
    return chosen < JOIN_MAX_PARTS && covered.size < REACH * total && gainOf(next, covered) >= MIN_GAIN * total;
}

/** `chosen` and, one at a time, the frame of `pool` that adds the most, until a stop of {@link worthAdding}. */
function extended(chosen: readonly Candidate[], pool: readonly Candidate[], total: number): readonly Candidate[] {
    const covered = unionOf(chosen);
    const first = chosen[0];
    const next = bestOf(pool, covered, first === undefined ? undefined : cameraOf(first.frame));
    if (next === undefined || !worthAdding(next, covered, chosen.length, total)) {
        return chosen;
    }
    return extended(
        [...chosen, next],
        pool.filter((candidate) => candidate !== next),
        total,
    );
}

function isRendered(candidate: Candidate): boolean {
    return candidate.frame.renderedBounds !== undefined;
}

/** A frame the plan may choose without anyone paying: free, or already here. */
function isObtainable({ frame }: Candidate): boolean {
    return frame.free || frame.versionId !== undefined;
}

function rowFrame(frame: DatePlanFrame): DatePlanRow['frames'][number] {
    return {
        entityId: frame.entityId,
        free: frame.free,
        ...(frame.displayId === undefined ? {} : { displayId: frame.displayId }),
        ...(frame.versionId === undefined ? {} : { versionId: frame.versionId }),
        ...(frame.state === undefined ? {} : { state: frame.state }),
    };
}

/** The obtainable frames the choice left out, the most of the city first. */
function sparesOf(pool: readonly Candidate[], chosen: readonly Candidate[]): string[] {
    return pool
        .filter((candidate) => !chosen.includes(candidate))
        .sort((left, right) => right.cells.size - left.cells.size || left.frame.entityId.localeCompare(right.frame.entityId))
        .slice(0, JOIN_MAX_PARTS)
        .map((candidate) => candidate.frame.entityId);
}

/** What a date's choice picked: the chosen frames, the paid ones that would add to them, the spare ones. */
interface Picked {
    readonly chosen: readonly Candidate[];
    readonly paid: readonly Candidate[];
    readonly spare: string[];
}

/** The chosen and paid frames probably cloudy over the city: the row warns before anyone imports or buys them. */
function cloudyOf(candidates: readonly Candidate[]): NonNullable<DatePlanRow['cloudyFrames']> {
    return candidates.flatMap(({ frame }) =>
        frame.cloudPercent !== undefined && frame.cloudPercent >= CLOUDY_CITY_PERCENT
            ? [{ entityId: frame.entityId, percent: frame.cloudPercent }]
            : [],
    );
}

/** The row of what was picked. */
function rowOf({ chosen, paid, spare }: Picked, total: number, first: DatePlanFrame): DatePlanRow {
    const frames = chosen.map((candidate) => candidate.frame);
    const cloudy = cloudyOf([...chosen, ...paid]);
    return {
        date: first.date,
        sensor: first.sensor,
        frames: frames.map(rowFrame),
        paidFrames: paid.map((candidate) => candidate.frame.entityId),
        ...(spare.length === 0 ? {} : { spareFrames: spare }),
        ...(cloudy.length === 0 ? {} : { cloudyFrames: cloudy }),
        coveragePct: roundTo((unionOf(chosen).size / total) * 100, 1),
        framesToDownload: frames.filter((frame) => frame.versionId === undefined).length,
        winter: WINTER_MONTHS.has(first.date.slice(5, 7)),
    };
}

/**
 * The plan of one date's frames (one date, one camera): start from the rendered frames, then add the frame covering the most
 * cells still uncovered; a tie goes to a free frame, then one of the same camera, then an imported one. Paid frames are
 * never chosen, only listed when they would add. Undefined when there is nothing to join: fewer than two frames in all,
 * or none obtainable.
 */
export function planDate(frames: readonly DatePlanFrame[], bounds: BoundsRecord): DatePlanRow | undefined {
    const [first] = frames;
    if (first === undefined || frames.length < 2) {
        return undefined;
    }
    const grid = gridOf(bounds);
    const candidates = frames.map((frame) => candidateOf(frame, grid, (bounds.west + bounds.east) / 2));
    const rendered = candidates.filter(isRendered).slice(0, JOIN_MAX_PARTS);
    const rest = candidates.filter((candidate) => !isRendered(candidate));
    const obtainable = rest.filter(isObtainable);
    const chosen = extended(rendered, obtainable, grid.length);
    const paid = extended(
        chosen,
        rest.filter((candidate) => !isObtainable(candidate)),
        grid.length,
    ).slice(chosen.length);
    return chosen.length > 0 && chosen.length + paid.length > 1
        ? rowOf({ chosen, paid, spare: sparesOf(obtainable, chosen) }, grid.length, first)
        : undefined;
}

/** Largest first: reaches the city, a target year, not winter, fewest downloads. */
function rowOrder(row: DatePlanRow, targetYears: readonly number[]): readonly number[] {
    return [
        Number(row.coveragePct >= REACH * 100),
        Number(targetYears.includes(Number(row.date.slice(0, 4)))),
        Number(!row.winter),
        -row.framesToDownload,
    ];
}

function framesByDate(frames: readonly DatePlanFrame[]): readonly (readonly DatePlanFrame[])[] {
    const groups = new Map<string, DatePlanFrame[]>();
    for (const frame of frames) {
        const key = `${frame.date} ${frame.sensor}`;
        groups.set(key, [...(groups.get(key) ?? []), frame]);
    }
    return [...groups.values()];
}

/** A date the admin is already working on: one of its frames was imported. */
function hasWork(row: DatePlanRow): boolean {
    return row.frames.some((frame) => frame.versionId !== undefined);
}

/**
 * Every date's row, best first, at most `DATE_PLAN_MAX_ROWS`: dates that reach the city, then target years, then outside
 * winter (so 1972-08-08 ranks above the snowy 1972-02-02), then the fewest downloads, then the earliest. The cap leaves out
 * dates nobody started first: a frame waiting for approval must keep its row, or its page has no offer.
 */
export function planDates(frames: readonly DatePlanFrame[], bounds: BoundsRecord, targetYears: readonly number[]): DatePlanRow[] {
    const sorted = framesByDate(frames)
        .flatMap((group) => planDate(group, bounds) ?? [])
        .map((row) => ({ row, order: rowOrder(row, targetYears) }))
        .sort((left, right) => compareLists(left.order, right.order) || left.row.date.localeCompare(right.row.date))
        .map(({ row }) => row);
    const kept = new Set([...sorted.filter(hasWork), ...sorted].slice(0, DATE_PLAN_MAX_ROWS));
    return sorted.filter((row) => kept.has(row));
}
