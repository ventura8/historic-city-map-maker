/**
 * Batch 4: the admin's lazy `local-run` chunk, fetched by the archive's feed the first time the owner picks files in the Imagery tab: the
 * client that streams them to the worker on this computer (`local-import.ts`) over its loopback (`local-transport.ts`).
 */
import type { Clock } from '../app/ports.js';
import { LocalImport } from './local-import.js';
import type { LocalImportState, LocalTransport } from './local-state.js';
import { loopbackTransport } from './local-transport.js';

/** The import over `transport` (the browser's loopback when none is given). */
export function createLocalImport(
    transport: LocalTransport | undefined,
    clock: Clock,
    changed: (state: LocalImportState) => void,
): LocalImport {
    return new LocalImport(transport ?? loopbackTransport(), clock, changed);
}
