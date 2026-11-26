/**
 * M20's fields of a server-written job (docs/research/M20-import-local.md §1.1, §1.3, §20): an archive series' originals on the
 * computer, the day it counted, and the copy of its sheets another computer sent with the hand-backs before it.
 */
import { past, type Data } from './world.js';

export function archiveJobFields(): Data {
    return {
        localOnly: true,
        countedAt: past(),
        archiveCopy: { by: 'w-fedcba9876543210', at: past(), bytes: 4096 },
        archiveReturns: 1,
    };
}
