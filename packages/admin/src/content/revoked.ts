/**
 * A revoked admin's editors (`DECISIONS-for-review.md` §35e, S-A20-BAD-REVOKED-WHILE-EDITING): once the shell knows the
 * account is no admin any more while an editor held unsaved changes, the open page stays on screen, read-only, until
 * sign-out. Every write of the editors is then refused at once as `denied` (the rules would refuse it anyway, with a
 * 403 the browser logs), so the drafts stay as typed and nothing is sent; reads go on as they are.
 */
import type { ContentStore, WriteOutcome } from './services.js';

const DENIED: WriteOutcome = { ok: false, reason: 'denied' };

/** `store` whose writes are refused while `refused()` says so. */
export function writesRefusedWhen(store: ContentStore, refused: () => boolean): ContentStore {
    const guarded =
        <A extends unknown[]>(write: (...args: A) => Promise<WriteOutcome>) =>
        (...args: A): Promise<WriteOutcome> =>
            refused() ? Promise.resolve(DENIED) : write(...args);
    return {
        watchDoc: store.watchDoc.bind(store),
        watchQuery: store.watchQuery.bind(store),
        count: store.count.bind(store),
        update: guarded(store.update.bind(store)),
        create: guarded(store.create.bind(store)),
        remove: guarded(store.remove.bind(store)),
        batch: guarded(store.batch.bind(store)),
        newId: store.newId.bind(store),
    };
}
