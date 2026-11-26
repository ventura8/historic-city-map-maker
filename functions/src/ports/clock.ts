/** Wall-clock time, injected so handlers and caches are deterministic under test. */
export interface Clock {
    now(): Date;
    /**
     * Waits `ms` (M6: the self-test's `events` check polls for `ops.onProbe`'s answer). Optional: a test clock without it
     * never waits, so a poll runs its rounds at once.
     */
    readonly sleep?: (ms: number) => Promise<void>;
}
