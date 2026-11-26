/**
 * How one Playwright run takes its part of the e2e queue when the run is split between machines (scripts/ci/e2e-split.sh,
 * docs/research/DECISIONS-for-review.md §32f): pure functions, read by `e2e/playwright.config.ts`, `e2e/projects.ts` and
 * `e2e/split-reporter.ts`, unit-tested in `e2e/test/split.test.ts`.
 *
 * - `E2E_SHARD`: "index/total" is one of `total` equal slices of the queue (Playwright's `--shard`); "first-last/total" is
 *   the slices `first` to `last` together, one contiguous part, so a faster machine takes more of it.
 * - `E2E_ADMIN_PART`: "index/total" (or "first-last/total") keeps those of `total` parts of the admin tier's projects,
 *   dealt round robin. The locked admin tests run one at a time (one Firebase project per machine), so a split gives
 *   each machine its own share of that chain instead of putting all of it into the head of the queue; the count slice of
 *   `E2E_SHARD` then applies to the other tiers only.
 */

/** Slices `first` to `last` of `total` equal ones (one slice: `first === last`). */
export interface ShardRange {
    readonly first: number;
    readonly last: number;
    readonly total: number;
}

const SHARD_FORMAT = /^(\d+)(?:-(\d+))?\/(\d+)$/;

function isWithin({ first, last, total }: ShardRange): boolean {
    return first >= 1 && first <= last && last <= total;
}

/** `E2E_SHARD` as a range; throws, naming the value, when it is malformed or out of 1..total. */
export function shardRangeOf(value: string): ShardRange {
    const [, first, last, total] = SHARD_FORMAT.exec(value) ?? [];
    const range = { first: Number(first), last: Number(last ?? first), total: Number(total) };
    if (!isWithin(range)) {
        throw new Error(`E2E_SHARD must be "index/total" or "first-last/total" within 1..total, got "${value}"`);
    }
    return range;
}

/** `E2E_SHARD` from the environment: null when unset or empty (the whole queue). */
export function shardRangeFrom(value: string | undefined): ShardRange | null {
    return value === undefined || value === '' ? null : shardRangeOf(value);
}

/**
 * `E2E_ADMIN_PART` from the environment: null when unset or empty (every admin project); "index/total" or
 * "first-last/total" (parts `first` to `last` of `total`); throws when malformed.
 */
export function adminPartFrom(value: string | undefined): ShardRange | null {
    if (value === undefined || value === '') {
        return null;
    }
    try {
        return shardRangeOf(value);
    } catch {
        throw new Error(`E2E_ADMIN_PART must be "index/total" or "first-last/total" within 1..total, got "${value}"`);
    }
}

/** Whether the admin project at `position` (0-based, in the order of e2e/projects.ts) is in `parts`: dealt round robin. */
export function inPart(position: number, parts: ShardRange | null): boolean {
    const part = parts === null ? 0 : (position % parts.total) + 1;
    return parts === null || (part >= parts.first && part <= parts.last);
}

/** The queue positions [from, to) of `range` in a queue of `count` tests; both machines compute the same boundaries. */
export function sliceBounds(count: number, { first, last, total }: ShardRange): { readonly from: number; readonly to: number } {
    return { from: Math.floor((count * (first - 1)) / total), to: Math.floor((count * last) / total) };
}

/** What the split needs to know of one test of the run, in queue order. */
export interface QueuedTest {
    /** Its project is a dependency of other projects (`setup`, `admin-setup`): it always runs, Playwright decides. */
    readonly dependency: boolean;
    /** Its project's tier (e2e/projects.ts `metadata.tier`). */
    readonly tier: string;
}

/**
 * The positions of `tests` (the whole queue, in order) that this run leaves out: of the tests outside the admin tier and
 * the dependency projects, those outside `range`. The admin tests stay: `E2E_ADMIN_PART` already chose their projects.
 */
export function excludedPositions(tests: readonly QueuedTest[], range: ShardRange): number[] {
    const sliced = tests.flatMap((test, position) => (test.dependency || test.tier === 'admin' ? [] : [position]));
    const { from, to } = sliceBounds(sliced.length, range);
    return sliced.filter((_, index) => index < from || index >= to);
}
