/**
 * One read of a query as the server answers it, through the content store's listener (`ContentStore` has no one-shot
 * read): the first answer that is not the local cache's, then the listener goes. A listener's first answer may be the
 * cache's, and the cache holds only what other listeners brought (a list's first page): taken for the whole collection,
 * it would export 50 places of 900. Offline only the cache answers, so after `READ_WAIT_MS` the read gives up. A read that
 * did not answer says why: a caller must never take it for an empty collection, and a refusal is not the same as being offline.
 */
import type { Schema } from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import type { ContentQuery, ContentServices, StoredPage } from './services.js';

/** How long a read waits for the server: longer than a whole city's places take, shorter than an admin's patience. */
export const READ_WAIT_MS = 30_000;

/** Why a read gave no answer: refused by the rules, or anything else (offline, slow, a failed listener). */
export type ReadFailure = 'denied' | 'offline';

/** A page, or why there is none. */
export type ReadAnswer<T> =
    { readonly page: StoredPage<T>; readonly failure: null } | { readonly page: null; readonly failure: ReadFailure };

/** The query's first answer from the server, or why the listener failed or the server did not answer in time. */
export function readOnce<T>(
    services: Pick<ContentServices, 'store' | 'clock'>,
    collection: string,
    schema: Schema<T>,
    query: ContentQuery,
): Promise<ReadAnswer<T>> {
    const { store, clock } = services;
    return new Promise((resolve) => {
        const read: { settled: boolean; stop: Unsubscribe | null; timer: unknown } = { settled: false, stop: null, timer: null };
        const settle = (answer: ReadAnswer<T>): void => {
            if (!read.settled) {
                read.settled = true;
                clock.clearTimeout(read.timer);
                resolve(answer);
                read.stop?.();
            }
        };
        read.timer = clock.setTimeout(() => {
            settle({ page: null, failure: 'offline' });
        }, READ_WAIT_MS);
        const answered = (page: StoredPage<T>): void => {
            if (!page.fromCache) {
                settle({ page, failure: null });
            }
        };
        const stop = store.watchQuery(collection, schema, query, answered, (failure) => {
            settle({ page: null, failure: failure.kind === 'denied' ? 'denied' : 'offline' });
        });
        read.stop = stop;
        if (read.settled) {
            stop();
        }
    });
}
