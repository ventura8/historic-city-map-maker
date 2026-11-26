// One read of a query as the server answers it: the local cache's answers do not count, a failure or no answer in time says why.
import { FIRESTORE_PATHS, poiDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { READ_WAIT_MS, readOnce } from '../../src/content/read-once.js';
import { CITY, contentWorld } from './world.js';

const COLLECTION = FIRESTORE_PATHS.pois(CITY);
const QUERY = { limit: 10 };

describe('readOnce', () => {
    it('happyPath_theServersAnswerAndTheListenerGoes', async () => {
        const world = contentWorld();

        const { page } = await readOnce(world.services, COLLECTION, poiDocSchema, QUERY);

        expect(page).toMatchObject({ docs: [], fromCache: false });
        expect(world.store.listeners()).toBe(0);
    });

    it('happyPath_aListenerThatAnswersLaterStopsThenAndOnlyOnce', async () => {
        const world = contentWorld();
        const answers: ((page: unknown) => void)[] = [];
        let stopped = 0;
        const store = {
            ...world.services.store,
            watchQuery: (_collection: string, _schema: unknown, _query: unknown, listener: (page: unknown) => void) => {
                answers.push(listener);
                return () => {
                    stopped += 1;
                };
            },
        };
        const pending = readOnce({ store: store as never, clock: world.clock }, COLLECTION, poiDocSchema, QUERY);

        answers[0]?.({ docs: ['of the cache'], fromCache: true });
        answers[0]?.({ docs: [1], fromCache: false });
        answers[0]?.({ docs: [2], fromCache: false });

        expect(await pending).toEqual({ page: { docs: [1], fromCache: false }, failure: null });
        expect(stopped).toBe(1);
    });

    it('badPath_theCachesAnswerIsNeverTakenForAll_backOnlineTheServerAnswers', async () => {
        const world = contentWorld();
        world.store.setOffline(true);
        const pending = readOnce(world.services, COLLECTION, poiDocSchema, QUERY);
        expect(world.store.listeners(COLLECTION)).toBe(1);

        world.store.setOffline(false);

        expect(await pending).toMatchObject({ page: { fromCache: false } });
        expect(world.store.listeners(COLLECTION)).toBe(0);
    });

    it('badPath_offlineTheReadGivesUp', async () => {
        const world = contentWorld();
        world.store.setOffline(true);
        const pending = readOnce(world.services, COLLECTION, poiDocSchema, QUERY);

        world.clock.advance(READ_WAIT_MS - 1);
        expect(world.store.listeners(COLLECTION)).toBe(1);
        world.clock.advance(1);

        expect(await pending).toEqual({ page: null, failure: 'offline' });
        expect(world.store.listeners(COLLECTION)).toBe(0);
    });

    it('badPath_aFailedReadSaysOffline', async () => {
        const world = contentWorld();
        const pending = readOnce(world.services, COLLECTION, poiDocSchema, QUERY);
        expect((await pending).page).not.toBeNull();

        const failing = {
            ...world.services.store,
            watchQuery: (...args: readonly unknown[]) => {
                (args[4] as (failure: { kind: 'failed'; code: string }) => void)({ kind: 'failed', code: 'x' });
                return () => undefined;
            },
        };
        expect(await readOnce({ store: failing as never, clock: world.clock }, COLLECTION, poiDocSchema, QUERY)).toEqual({
            page: null,
            failure: 'offline',
        });
    });

    it('badPath_aReadThatIsRefusedLaterSaysDenied', async () => {
        const world = contentWorld();
        world.store.setOffline(true);
        const pending = readOnce(world.services, COLLECTION, poiDocSchema, QUERY);

        world.store.fail(COLLECTION, { kind: 'denied', code: 'permission-denied' });

        expect(await pending).toEqual({ page: null, failure: 'denied' });
    });
});
