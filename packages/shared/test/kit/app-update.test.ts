/**
 * The installed app keeps itself up to date (`packages/shared/src/kit/app-update.ts`), on a window made of plain objects
 * and a hand-driven clock: it looks at start, on focus, on a return and every 15 minutes; a newer build reloads the page
 * at a safe moment and otherwise waits with `updateReady` and `hcm-update-ready`; it never reloads twice for one build.
 */
import { describe, expect, it } from 'vitest';

import {
    APP_UPDATE_PARTS,
    UPDATE_IDLE_MS,
    UPDATE_LOOK_MS,
    UPDATE_RELOADED_KEY,
    UPDATE_RETRY_MS,
    appUpdateSource,
    markReload,
    servedBuild,
    watchAppUpdates,
    type AppUpdateScope,
    type AppUpdates,
} from '../../src/kit/app-update.js';

const OWN = 'build-1';
const NEWER = 'build-2';

interface WindowOptions {
    /** What `app-build.json` answers: a build, a status, or a refused request. */
    served?: string | number | { readonly refused: true };
    storage?: 'ok' | 'throws' | 'forgets';
    workers?: boolean | 'throws';
    app?: boolean;
}

function fakeWindow(options: WindowOptions = {}) {
    const listeners = new Map<string, (() => void)[]>();
    const timers: { at: number; every: number; handler: () => void }[] = [];
    const stored = new Map<string, string>();
    const record = { now: 0, reloads: 0, fetched: [] as string[], updates: 0, said: [] as string[], visibility: 'visible' };
    const on = (type: string, listener: () => void): void => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    };
    const storage = options.storage ?? 'ok';
    const app: AppUpdates = {};
    const scope: AppUpdateScope = {
        ...(options.app === false ? {} : { HistoricCityMapApp: app }),
        navigator:
            options.workers === false
                ? {}
                : {
                      serviceWorker: {
                          getRegistration: () => {
                              if (options.workers === 'throws') {
                                  throw new DOMException('not allowed', 'InvalidStateError');
                              }
                              return Promise.resolve({
                                  update: () => {
                                      record.updates += 1;
                                      return Promise.resolve();
                                  },
                              });
                          },
                      },
                  },
        document: {
            get visibilityState() {
                return record.visibility;
            },
            addEventListener: (type, listener) => {
                on(`document:${type}`, listener);
            },
        },
        location: {
            reload: () => {
                record.reloads += 1;
            },
        },
        sessionStorage: {
            getItem: (key) => {
                if (storage === 'throws') {
                    throw new Error('blocked');
                }
                return stored.get(key) ?? null;
            },
            setItem: (key, value) => {
                if (storage === 'ok') {
                    stored.set(key, value);
                }
            },
        },
        performance: { now: () => record.now },
        fetch: (url) => {
            record.fetched.push(url);
            const served = options.served ?? OWN;
            if (typeof served === 'object') {
                return Promise.reject(new TypeError('Failed to fetch'));
            }
            const ok = typeof served === 'string';
            return Promise.resolve({ ok, json: () => Promise.resolve(ok ? { build: served } : {}) });
        },
        setTimeout: (handler, ms) => timers.push({ at: record.now + ms, every: 0, handler }),
        setInterval: (handler, ms) => timers.push({ at: record.now + ms, every: ms, handler }),
        addEventListener: (type, listener) => {
            on(type, listener);
        },
        dispatchEvent: (event) => {
            record.said.push(event.type);
            return true;
        },
    };
    const fire = (type: string): void => {
        for (const listener of listeners.get(type) ?? []) {
            listener();
        }
    };
    /** Moves the clock, running each timer due on the way. */
    const advance = (ms: number): void => {
        const end = record.now + ms;
        for (let due = timers.find((timer) => timer.at <= end); due !== undefined; due = timers.find((timer) => timer.at <= end)) {
            record.now = due.at;
            if (due.every > 0) {
                due.at += due.every;
            } else {
                timers.splice(timers.indexOf(due), 1);
            }
            due.handler();
        }
        record.now = end;
    };
    const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
    const start = (withBuild = true) => {
        watchAppUpdates(scope, withBuild ? { build: OWN, version: 'app-build.json' } : {}, APP_UPDATE_PARTS);
        return settled();
    };
    return { scope, app, record, stored, fire, advance, settled, start, options };
}

describe('watchAppUpdates: when it looks', () => {
    it('happyPath_atStartOnFocusOnAReturnAndEveryFifteenMinutes', async () => {
        const w = fakeWindow();
        await w.start();
        expect(w.record.fetched).toEqual(['app-build.json']);
        expect(w.record.updates).toBe(1);

        w.fire('focus');
        await w.settled();
        w.record.visibility = 'visible';
        w.fire('document:visibilitychange');
        await w.settled();
        w.advance(UPDATE_LOOK_MS);
        await w.settled();

        expect(w.record.fetched).toHaveLength(4);
        expect(w.record.updates).toBe(4);
        expect(w.record.reloads).toBe(0);
        expect(w.app.updateReady).toBe(false);
    });

    it('badPath_aFocusDuringALookStartsNoSecondOne', async () => {
        const w = fakeWindow();
        watchAppUpdates(w.scope, { build: OWN, version: 'app-build.json' }, APP_UPDATE_PARTS);
        w.fire('focus');
        await w.settled();

        expect(w.record.fetched).toHaveLength(1);
    });

    it.each([
        ['a refused request', { refused: true as const }],
        ['a missing file', 404],
    ])('badPath_%s_isNoNews', async (_name, served) => {
        const w = fakeWindow({ served });
        await w.start();
        w.advance(UPDATE_IDLE_MS);

        expect(w.record.reloads).toBe(0);
        expect(w.record.said).toEqual([]);
    });

    it('badPath_withoutABuildOnlyTheWorkerIsAskedToUpdate', async () => {
        const w = fakeWindow({ served: NEWER, workers: false });
        await w.start(false);

        expect(w.record.fetched).toEqual([]);
        expect(w.record.updates).toBe(0);
        expect(w.record.reloads).toBe(0);
    });

    it('badPath_aWorkerLookupThatThrowsStillReadsTheBuild', async () => {
        const w = fakeWindow({ served: NEWER, workers: 'throws' });
        w.record.visibility = 'hidden';
        await w.start();

        expect(w.record.updates).toBe(0);
        expect(w.record.reloads).toBe(1);
    });

    it('badPath_aPageWithoutItsAppHasNothingToWatch', async () => {
        const w = fakeWindow({ app: false });
        await w.start();

        expect(w.record.fetched).toEqual([]);
    });
});

describe('watchAppUpdates: a newer build', () => {
    it('happyPath_aHiddenPageReloadsAtOnceAndRemembersTheBuild', async () => {
        const w = fakeWindow({ served: NEWER });
        w.record.visibility = 'hidden';
        await w.start();

        expect(w.record.reloads).toBe(1);
        expect(w.stored.get(UPDATE_RELOADED_KEY)).toBe(NEWER);
    });

    it('happyPath_aVisiblePageWaitsWithTheSnackbarThenReloadsOnceIdle', async () => {
        const w = fakeWindow({ served: NEWER });
        await w.start();
        expect(w.record.reloads).toBe(0);
        expect(w.app.updateReady).toBe(true);
        expect(w.record.said).toEqual(['hcm-update-ready']);

        w.advance(UPDATE_IDLE_MS - UPDATE_RETRY_MS);
        expect(w.record.reloads).toBe(0);
        w.advance(UPDATE_RETRY_MS);
        expect(w.record.reloads).toBe(1);
        expect(w.record.said).toEqual(['hcm-update-ready']);
    });

    it('happyPath_leavingThePageIsASafeMoment', async () => {
        const w = fakeWindow({ served: NEWER });
        await w.start();
        w.record.visibility = 'hidden';
        w.fire('document:visibilitychange');

        expect(w.record.reloads).toBe(1);
    });

    it('badPath_aHoldOrAPressedPointerKeepsThePage', async () => {
        const w = fakeWindow({ served: NEWER });
        const held = { open: true };
        await w.start();
        const release = w.app.holdReload?.(() => held.open);
        w.record.visibility = 'hidden';
        w.fire('document:visibilitychange');
        expect(w.record.reloads).toBe(0);

        release?.();
        w.fire('pointerdown');
        w.advance(UPDATE_RETRY_MS);
        expect(w.record.reloads).toBe(0);

        w.fire('pointerup');
        w.advance(UPDATE_RETRY_MS);
        expect(w.record.reloads).toBe(1);
    });

    it('badPath_inputKeepsAVisiblePageUntilAMinuteOfQuiet', async () => {
        const w = fakeWindow({ served: NEWER });
        await w.start();
        w.advance(UPDATE_IDLE_MS - UPDATE_RETRY_MS);
        w.fire('keydown');
        w.advance(UPDATE_IDLE_MS - UPDATE_RETRY_MS);
        expect(w.record.reloads).toBe(0);

        w.advance(UPDATE_RETRY_MS);
        expect(w.record.reloads).toBe(1);
    });

    it('happyPath_reloadReloadsNowAndCountsAsTheReloadForTheBuild', async () => {
        const w = fakeWindow({ served: NEWER });
        await w.start();
        w.app.reload?.();

        expect(w.record.reloads).toBe(1);
        expect(w.stored.get(UPDATE_RELOADED_KEY)).toBe(NEWER);
    });

    it('happyPath_reloadWithoutANewerBuildStillReloads', async () => {
        const w = fakeWindow();
        await w.start();
        w.app.reload?.();

        expect(w.record.reloads).toBe(1);
        expect(w.stored.has(UPDATE_RELOADED_KEY)).toBe(false);
    });
});

describe('watchAppUpdates: never a loop', () => {
    it('badPath_aPageStillOlderAfterItsReloadOnlyOffersReload', async () => {
        const w = fakeWindow({ served: NEWER });
        w.stored.set(UPDATE_RELOADED_KEY, NEWER);
        w.record.visibility = 'hidden';
        await w.start();
        w.advance(10 * UPDATE_RETRY_MS);

        expect(w.record.reloads).toBe(0);
        expect(w.app.updateReady).toBe(true);
        expect(w.record.said).toEqual(['hcm-update-ready']);
    });

    it.each([
        ['storage that throws', 'throws' as const],
        ['storage that forgets', 'forgets' as const],
    ])('badPath_%s_neverReloadsByItself', async (_name, storage) => {
        const w = fakeWindow({ served: NEWER, storage });
        w.record.visibility = 'hidden';
        await w.start();

        expect(w.record.reloads).toBe(0);
        expect(w.app.updateReady).toBe(true);
    });
});

describe('the parts', () => {
    it('happyPath_markReloadOncePerBuild', () => {
        const w = fakeWindow();
        expect(markReload(w.scope, NEWER)).toBe(true);
        expect(markReload(w.scope, NEWER)).toBe(false);
        expect(markReload(w.scope, 'build-3')).toBe(true);
    });

    it('badPath_servedBuildOfAnEmptyBuild', async () => {
        await expect(servedBuild(fakeWindow({ served: '' }).scope, 'app-build.json')).resolves.toBeNull();
    });

    it('badPath_servedBuildOfABodyThatIsNoObject', async () => {
        const scope = { fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve('build') }) };
        await expect(servedBuild(scope, 'app-build.json')).resolves.toBeNull();
    });

    it('happyPath_theSourceStartsTheWatchWithItsPartsOnTheWindow', () => {
        const source = appUpdateSource({ build: OWN, version: 'app-build.json' });
        expect(source).toContain(')(window, {"build":"build-1","version":"app-build.json"}, { mark: ');
        expect(source).toContain('hcm-app-reloaded-for');
        expect(source).toContain('hcm-update-ready');
    });
});
