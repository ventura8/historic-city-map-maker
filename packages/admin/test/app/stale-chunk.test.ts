// Live 2026-11-24: after a redeploy an open admin asked for the old release's lazy chunk, Hosting answered it with
// index.html and the shell said "The page did not load". A page that fails now reloads the tab once into the newer admin.
import { describe, expect, it, vi } from 'vitest';

import { RELOADED_FOR_KEY } from '../../src/app/release-reload.js';
import { reloadOnStaleChunk, type StaleChunkDeps } from '../../src/app/stale-chunk.js';

const NEWER = '1.0.1+abc1234';
const GONE = new TypeError('Failed to fetch dynamically imported module: /admin/assets/imagery-old.js');

interface WorldOptions {
    /** What the release watch says Hosting serves: a newer release, null, a failed read, or no watch at all. */
    newer?: string | null;
    /** The watch's read fails, or there is no watch at all. */
    watch?: 'fails' | 'none';
    /** A storage that forgets every write. */
    forgets?: boolean;
    reloadedFor?: string;
}

function world(options: WorldOptions = {}) {
    const stored = new Map<string, string>();
    if (options.reloadedFor !== undefined) {
        stored.set(RELOADED_FOR_KEY, options.reloadedFor);
    }
    const reload = vi.fn();
    const log = { info: vi.fn(), warn: vi.fn() };
    const newer = options.newer === undefined ? NEWER : options.newer;
    const check = vi.fn((): Promise<string | null> =>
        options.watch === 'fails' ? Promise.reject(new Error('offline')) : Promise.resolve(newer),
    );
    const deps: StaleChunkDeps = {
        releases: options.watch === 'none' ? undefined : { check },
        session: {
            get: (key) => stored.get(key) ?? null,
            set: (key, value) => {
                if (options.forgets !== true) {
                    stored.set(key, value);
                }
            },
        },
        location: { reload },
        log,
    };
    return { deps, reload, log, stored, check };
}

describe('reloadOnStaleChunk', () => {
    it('passes a page that loads through without asking for the release', async () => {
        const { deps, reload, check } = world();
        const load = reloadOnStaleChunk<string>(() => Promise.resolve('hcm-imagery-page'), deps);

        await expect(load('imagery')).resolves.toBe('hcm-imagery-page');
        expect(check).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
    });

    it('reloads once into the newer release when a chunk of the older admin is gone @S-A29-HAPPY-STALE-CHUNK-RELOAD', async () => {
        const { deps, reload, stored, log } = world();
        const load = reloadOnStaleChunk<string>(() => Promise.reject(GONE), deps);
        let settled = false;
        void load('imagery').finally(() => {
            settled = true;
        });
        await vi.waitFor(() => {
            expect(reload).toHaveBeenCalledTimes(1);
        });

        expect(stored.get(RELOADED_FOR_KEY)).toBe(NEWER);
        expect(log.info).toHaveBeenCalledWith(expect.stringContaining('reloads into the newer release'), {
            page: 'imagery',
            release: NEWER,
        });
        expect(settled).toBe(false);
    });

    it.each([
        ['the tab already reloaded for that release', { reloadedFor: NEWER }],
        ['the storage cannot remember the reload', { forgets: true }],
        ['Hosting still serves this admin', { newer: null }],
        ['the release cannot be read', { watch: 'fails' as const }],
        ['the build watches no release', { watch: 'none' as const }],
    ])('passes the failure on, never looping, when %s @S-A29-BAD-STALE-CHUNK-NO-LOOP', async (_why, options: WorldOptions) => {
        const { deps, reload, log } = world(options);
        const load = reloadOnStaleChunk<string>(() => Promise.reject(GONE), deps);

        await expect(load('imagery')).rejects.toBe(GONE);
        expect(reload).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith('a page did not load and no reload can help', expect.objectContaining({ page: 'imagery' }));
    });
});
