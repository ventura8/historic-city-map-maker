// M18 item 1 (docs/research/M18-improvements.md): after a deploy the tab reloads into the newer admin by itself when no
// one is looking or the owner has just come back, and only when no edit would be lost; otherwise the Reload banner.
import { describe, expect, it, vi } from 'vitest';

import type { PageVisibility } from '../../src/app/ports.js';
import { followReleases, RELOAD_RETRY_MS, RELOADED_FOR_KEY, RETURN_WINDOW_MS } from '../../src/app/release-reload.js';
import type { ShellStateAccess } from '../../src/state/state.js';
import { FakeClock, testLog } from './fakes.js';

const NEWER = '1.0.1+abc1234';

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

interface WorldOptions {
    shown?: boolean;
    unsaved?: boolean;
    /** Whether nobody uses the tab; absent: no activity watch. */
    idle?: boolean;
    /** The tab's storage: absent, one that remembers, or one that forgets every write. */
    session?: 'remembers' | 'forgets';
}

function sessionOf(kind: WorldOptions['session'], stored: Map<string, string>) {
    if (kind === undefined) {
        return undefined;
    }
    return {
        get: (key: string) => stored.get(key) ?? null,
        set: (key: string, value: string) => {
            if (kind === 'remembers') {
                stored.set(key, value);
            }
        },
    };
}

function world(options: WorldOptions = {}) {
    const clock = new FakeClock();
    const visibility = new SwitchedVisibility();
    visibility.shown = options.shown ?? true;
    const state = { unsaved: options.unsaved ?? false, idle: options.idle ?? false, reloads: 0, banner: null as string | null };
    const stored = new Map<string, string>();
    const heard: { listener?: (release: string) => void } = {};
    const stopNewer = vi.fn();
    const releases = {
        onNewer: vi.fn((listener: (release: string) => void) => {
            heard.listener = listener;
            return stopNewer;
        }),
        stop: vi.fn(),
    };
    const shell = {
        update: (patch: { newRelease?: string | null }) => {
            state.banner = patch.newRelease ?? null;
        },
    } as unknown as ShellStateAccess;
    const { log, recording } = testLog();
    const stop = followReleases(
        {
            ...{ releases, visibility, clock, log },
            location: {
                reload: () => {
                    state.reloads += 1;
                },
            },
            unsaved: () => state.unsaved,
            idle: options.idle === undefined ? undefined : () => state.idle,
            session: sessionOf(options.session, stored),
        },
        shell,
    );
    const serve = (): void => {
        heard.listener?.(NEWER);
    };
    return { clock, visibility, state, serve, stop, releases, stopNewer, recording, stored };
}

describe('followReleases: a reload by itself', () => {
    it('happyPath_theOwnerComesBackAfterADeploy_theTabReloadsWithoutABanner', () => {
        const w = world({ shown: false });
        w.visibility.set(true);
        w.clock.advance(RETURN_WINDOW_MS - 1);
        w.serve();
        expect(w.state.reloads).toBe(1);
        expect(w.state.banner).toBeNull();
        expect(w.recording.records.at(-1)).toMatchObject({ level: 'info', message: 'the admin reloads itself into the newer release' });
    });

    it('happyPath_aHiddenTabThatHearsOfANewerAdminReloadsAtOnce', () => {
        const w = world({ shown: false });
        w.serve();
        expect(w.state.reloads).toBe(1);
    });

    it('happyPath_aBannerShownWhileWorking_theNextReturnToTheTabReloads', () => {
        const w = world();
        w.serve();
        expect(w.state.banner).toBe(NEWER);
        expect(w.state.reloads).toBe(0);
        w.visibility.set(false);
        expect(w.state.reloads).toBe(0);
        w.visibility.set(true);
        expect(w.state.reloads).toBe(1);
    });
});

describe('followReleases: the Reload banner instead', () => {
    it('badPath_aNewerAdminSeenWhileTheOwnerWorks_isTheBannerNotAReload', () => {
        const w = world();
        w.visibility.set(true);
        w.clock.advance(RETURN_WINDOW_MS + 1);
        w.serve();
        expect(w.state.reloads).toBe(0);
        expect(w.state.banner).toBe(NEWER);
    });

    it('badPath_anUnsavedEditIsNeverLost_theBannerStaysOnEveryReturn', () => {
        const w = world({ shown: false, unsaved: true });
        w.serve();
        w.visibility.set(true);
        expect(w.state.reloads).toBe(0);
        expect(w.state.banner).toBe(NEWER);
    });

    it('badPath_aReturnBeforeAnyNewerReleaseReloadsNothing', () => {
        const w = world();
        w.visibility.set(false);
        w.visibility.set(true);
        expect(w.state.reloads).toBe(0);
    });

    it('happyPath_theReturnedCallEndsTheWatchAndTheVisibilityListener', () => {
        const w = world();
        w.stop();
        expect(w.stopNewer).toHaveBeenCalledTimes(1);
        expect(w.releases.stop).toHaveBeenCalledTimes(1);
        expect(w.visibility.listeners.size).toBe(0);
    });

    it('happyPath_withoutAWatchNothingIsFollowed', () => {
        const clock = new FakeClock();
        const stop = followReleases(
            {
                ...{ visibility: new SwitchedVisibility(), clock, log: testLog().log },
                location: { reload: () => undefined },
                unsaved: () => false,
            },
            {} as ShellStateAccess,
        );
        expect(() => {
            stop();
        }).not.toThrow();
    });
});

describe('followReleases: the installed app updates itself (2026-11-14)', () => {
    it('happyPath_aVisibleTabNobodyUsesReloadsAtOnce_andRemembersTheRelease', () => {
        const w = world({ idle: true, session: 'remembers' });
        w.clock.advance(RETURN_WINDOW_MS + 1);
        w.serve();
        expect(w.state.reloads).toBe(1);
        expect(w.state.banner).toBeNull();
        expect(w.stored.get(RELOADED_FOR_KEY)).toBe(NEWER);
    });

    it('happyPath_aTabInUseShowsTheBanner_thenReloadsOnceNobodyUsesIt', () => {
        const w = world({ idle: false, session: 'remembers' });
        w.clock.advance(RETURN_WINDOW_MS + 1);
        w.serve();
        expect(w.state.banner).toBe(NEWER);
        w.clock.advance(RELOAD_RETRY_MS);
        expect(w.state.reloads).toBe(0);
        w.state.idle = true;
        w.clock.advance(RELOAD_RETRY_MS);
        expect(w.state.reloads).toBe(1);
    });

    it('badPath_anUnsavedEditHoldsTheRetriesToo', () => {
        const w = world({ idle: true, unsaved: true });
        w.serve();
        w.clock.advance(10 * RELOAD_RETRY_MS);
        expect(w.state.reloads).toBe(0);
        expect(w.state.banner).toBe(NEWER);
    });

    it('badPath_aTabStillOlderAfterItsReloadNeverReloadsAgain_onlyTheBanner', () => {
        const w = world({ shown: false, session: 'remembers' });
        w.stored.set(RELOADED_FOR_KEY, NEWER);
        w.serve();
        w.visibility.set(true);
        w.clock.advance(10 * RELOAD_RETRY_MS);
        expect(w.state.reloads).toBe(0);
        expect(w.state.banner).toBe(NEWER);
        expect(w.recording.records.at(-1)).toMatchObject({ level: 'info', data: { release: NEWER } });
    });

    it('badPath_aTabThatCannotRememberNeverReloadsByItself', () => {
        const w = world({ shown: false, session: 'forgets' });
        w.serve();
        expect(w.state.reloads).toBe(0);
        expect(w.state.banner).toBe(NEWER);
    });

    it('happyPath_stoppingCancelsAWaitingRetry', () => {
        const w = world({ idle: false });
        w.clock.advance(RETURN_WINDOW_MS + 1);
        w.serve();
        w.stop();
        w.state.idle = true;
        w.clock.advance(RELOAD_RETRY_MS);
        expect(w.state.reloads).toBe(0);
    });
});
