// The admin's watch of its own release (finding 29 of docs/research/manual-test-2026-10-25.md, live test 2026-10-31): a
// tab left open across a redeploy reads `runtime.json` again when it becomes visible, every five minutes while visible,
// and before an install build; once Hosting serves another release it says so once and reads nothing more.
import { describe, expect, it, vi } from 'vitest';

import type { PageVisibility } from '../../src/app/ports.js';
import { RELEASE_LOOK_MS, RELEASE_REVISIT_MS, watchRelease } from '../../src/app/release-watch.js';
import { FakeClock, settle, testLog } from './fakes.js';

const OWN = '1.0.0+9e2e6b5';
const NEWER = '1.0.1+abc1234';

/** A tab whose visibility the test switches, announcing each change. */
class SwitchedVisibility implements PageVisibility {
    shown = true;
    readonly listeners = new Set<(visible: boolean) => void>();

    visible(): boolean {
        return this.shown;
    }

    onChange(listener: (visible: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    set(visible: boolean): void {
        this.shown = visible;
        for (const listener of [...this.listeners]) {
            listener(visible);
        }
    }
}

interface Served {
    /** What `runtime.json` answers: a release, or a status without a body. */
    body: Readonly<Record<string, unknown>> | number;
}

function world(release = OWN, shown = true) {
    const clock = new FakeClock();
    const visibility = new SwitchedVisibility();
    visibility.shown = shown;
    const served: Served = { body: { release } };
    const fetch = vi.fn((url: string, init?: RequestInit) => {
        expect(url).toBe('/runtime.json');
        expect(init?.cache).toBe('no-store');
        const body = served.body;
        return Promise.resolve(typeof body === 'number' ? new Response('', { status: body }) : Response.json(body));
    });
    const { log, recording } = testLog();
    const watch = watchRelease({ fetch, clock, visibility, release, log });
    const heard: string[] = [];
    watch.onNewer((newer) => {
        heard.push(newer);
    });
    return { clock, visibility, served, fetch, watch, heard, recording };
}

/** Moves the clock on and lets the read it started settle. */
async function after(clock: FakeClock, ms: number): Promise<void> {
    clock.advance(ms);
    await settle(40);
}

describe('watchRelease: a visible tab', () => {
    it('happyPath_aRedeployIsSeenAtTheNextLookAndSaidOnce', async () => {
        const { clock, served, fetch, watch, heard, recording } = world();
        await after(clock, RELEASE_LOOK_MS);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(heard).toEqual([]);

        served.body = { release: NEWER };
        await after(clock, RELEASE_LOOK_MS);

        expect(heard).toEqual([NEWER]);
        expect(watch.newer()).toBe(NEWER);
        expect(recording.records.at(-1)).toMatchObject({ level: 'info', message: 'a newer admin is served' });
        // Nothing more is read once it is known.
        await after(clock, 10 * RELEASE_LOOK_MS);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(clock.pending).toBe(0);
    });

    it('happyPath_aListenerAddedLaterHearsTheNewerReleaseAtOnce', async () => {
        const { clock, served, watch } = world();
        served.body = { release: NEWER };
        await after(clock, RELEASE_LOOK_MS);
        const late: string[] = [];

        const stop = watch.onNewer((newer) => {
            late.push(newer);
        });
        stop();

        expect(late).toEqual([NEWER]);
    });

    it('badPath_anUnreadableOrReleaselessFileIsNoNews', async () => {
        const { clock, served, fetch, watch, heard } = world();
        served.body = 503;
        await after(clock, RELEASE_LOOK_MS);
        served.body = { release: 'dev' };
        await after(clock, RELEASE_LOOK_MS);
        served.body = { startUp: true };
        await after(clock, RELEASE_LOOK_MS);

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(heard).toEqual([]);
        await expect(watch.check()).resolves.toBeNull();
    });
});

describe('watchRelease: visibility', () => {
    it('happyPath_aTabComingBackLooksAtOnceAndAgainEveryFiveMinutes', async () => {
        const { clock, visibility, served, fetch, heard } = world();
        visibility.set(false);
        await after(clock, 3 * RELEASE_LOOK_MS);
        expect(fetch).not.toHaveBeenCalled();

        served.body = { release: NEWER };
        visibility.set(true);
        await settle(40);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(heard).toEqual([NEWER]);
    });

    it('badPath_aTabComingBackWithinAMinuteOfALookReadsNothing', async () => {
        const { clock, visibility, fetch } = world();
        await after(clock, RELEASE_LOOK_MS);
        visibility.set(false);
        await after(clock, RELEASE_REVISIT_MS - 1);

        visibility.set(true);
        await settle(40);
        expect(fetch).toHaveBeenCalledTimes(1);

        await after(clock, RELEASE_LOOK_MS);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('badPath_aHiddenTabStartsWithoutATimer', () => {
        const { clock } = world(OWN, false);

        expect(clock.pending).toBe(0);
    });
});

describe('watchRelease: before an install build', () => {
    it('happyPath_checkReadsNowAndNamesTheNewerRelease', async () => {
        const { served, fetch, watch, heard } = world();
        await expect(watch.check()).resolves.toBeNull();

        served.body = { release: NEWER };

        await expect(watch.check()).resolves.toBe(NEWER);
        expect(heard).toEqual([NEWER]);
        await expect(watch.check()).resolves.toBe(NEWER);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('badPath_twoChecksAtOnceReadOnce', async () => {
        const { fetch, watch } = world();

        await Promise.all([watch.check(), watch.check()]);

        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe('watchRelease: without a release of its own', () => {
    it('badPath_aDevBuildWatchesNothing', async () => {
        const { clock, visibility, fetch, watch } = world('dev');
        visibility.set(false);
        visibility.set(true);
        await after(clock, 3 * RELEASE_LOOK_MS);

        await expect(watch.check()).resolves.toBeNull();
        expect(watch.newer()).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
        expect(visibility.listeners.size).toBe(0);
        watch.onNewer(() => undefined)();
        watch.stop();
    });

    it('happyPath_stopEndsTheWatch', async () => {
        const { clock, visibility, fetch, watch } = world();

        watch.stop();
        visibility.set(true);
        await after(clock, 3 * RELEASE_LOOK_MS);

        expect(fetch).not.toHaveBeenCalled();
        expect(visibility.listeners.size).toBe(0);
        expect(watch.newer()).toBeNull();
    });
});
