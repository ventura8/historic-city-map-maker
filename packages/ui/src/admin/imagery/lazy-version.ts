/**
 * A version's page as a chunk of its own (`docs/research/M12-own-tiles.md`; after `orders/lazy-card.ts`): the admin's
 * `approval-map-<hash>.js`, fetched when a version first opens, so the Imagery area's chunk stays within its budget.
 */
import type { versionDetail } from './approval-map.js';
import { chunkLoader, type ChunkLoader } from './orders/lazy-card.js';

export interface ApprovalMapChunk {
    readonly versionDetail: typeof versionDetail;
}

export const APPROVAL_MAP_CHUNK: ChunkLoader<ApprovalMapChunk> = chunkLoader(async () => import('./approval-map.js'));
