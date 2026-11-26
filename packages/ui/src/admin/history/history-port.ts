/**
 * The history area as its page reads it (`docs/research/M2c-interfaces.md` §9.2), mirroring
 * `packages/admin/src/history/` (checked at compile time by `packages/admin/test/app/admin-port.test.ts`).
 */
import type { AdminNoticeInputPort } from '../notice-port.js';
import type { DocStatePort, ListStatePort } from '../area-port.js';

export type HistoryEntityPort = 'city' | 'layer' | 'photo' | 'poi' | 'poiCategory' | 'story';
export type HistoryActionPort = 'create' | 'update' | 'delete' | 'revert';
export type HistoryActionFilterPort = 'all' | HistoryActionPort;

interface HistoryFilterPort {
    readonly entity: HistoryEntityPort | 'all';
    readonly action: HistoryActionFilterPort;
}

export interface HistoryItemPort {
    readonly entryId: string;
    readonly path: string;
    readonly entity: HistoryEntityPort;
    readonly entityId: string;
    readonly action: HistoryActionPort;
    readonly changedFields: readonly string[];
    readonly by: string;
    readonly at: string;
    readonly revertOf: string | null;
    readonly previous: Readonly<Record<string, unknown>> | null;
    readonly name: { readonly ro: string; readonly en?: string } | null;
}

export interface HistoryDocumentPort {
    readonly key: string;
    readonly document: { readonly entity: HistoryEntityPort; readonly cityId: string; readonly entityId: string } | null;
    readonly current: DocStatePort<Readonly<Record<string, unknown>>>;
    readonly entries: ListStatePort<HistoryItemPort>;
}

export interface HistoryViewState {
    readonly filter: HistoryFilterPort;
    readonly recent: ListStatePort<HistoryItemPort>;
    readonly document: HistoryDocumentPort | null;
    readonly selected: string | null;
    readonly changes: readonly { readonly field: string; readonly before: unknown; readonly after: unknown }[];
    readonly reverting: string | null;
    readonly refusal: AdminNoticeInputPort | null;
    readonly people: Readonly<Record<string, string>>;
}

export interface HistoryIntentsPort {
    setFilter(filter: Partial<HistoryFilterPort>): void;
    more(): void;
    retry(): void;
    select(entryId: string | null): void;
    revert(item: HistoryItemPort): Promise<boolean>;
    dismissRefusal(): void;
}
