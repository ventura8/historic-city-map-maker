/**
 * Pairing (finding 67 of 2026-11-02, `docs/research/M7-local-worker.md` §2.6): what the pairing callables and every
 * `worker.*` callable share. A one-time code is stored only as its id (the first 40 hex characters of its SHA-256); a
 * paired worker's token names that id (`pair`), and each of its calls finds the pairing still standing (exchanged, the
 * same owner, not revoked). The pipeline image the code's command named is the pairing's; `worker.hello` and
 * `worker.claim` compare it with the installed one (finding 74: the image the job `raster-pipeline` runs, else
 * `setup/status.install.pipeline.image`; `installed-image.ts`).
 */
import { createHash, randomBytes } from 'node:crypto';

import { FIRESTORE_PATHS, workerPairingDocSchema, type CallableName, type WorkerPairingDoc } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import type { CallableHandler } from '../api/callable.js';
import type { DocumentReader } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { installedImage, type InstalledImageDeps } from './installed-image.js';

/** RFC 4648's base32 alphabet, lower case: no 0, 1, 8 or 9 to misread. */
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** The code's length: 26 characters of 5 bits, 130 random bits. */
const CODE_LENGTH = 26;
const PAIR_ID_LENGTH = 40;

/** A new one-time code: 26 base32 characters from the system's random source. */
export function newPairCode(random: (size: number) => Uint8Array = randomBytes): string {
    return [...random(CODE_LENGTH)].map((byte) => BASE32[byte % BASE32.length] ?? 'a').join('');
}

/** The pairing's id: the first 40 hex characters of the code's SHA-256 (the code itself is never stored). */
export function pairIdOf(code: string): string {
    return createHash('sha256').update(code, 'utf8').digest('hex').slice(0, PAIR_ID_LENGTH);
}

/** True while the pairing stands for `uid`: exchanged, not revoked. */
function standing(pairing: WorkerPairingDoc | undefined, uid: string): pairing is WorkerPairingDoc {
    return pairing?.uid === uid && pairing.pairedAt !== undefined && pairing.revokedAt === undefined;
}

/**
 * A paired worker's pairing, which must still stand (`apiError.worker.revoked` otherwise); undefined for a worker signed
 * in with Google on its local page, which has none.
 */
async function requirePairing(reader: DocumentReader, caller: VerifiedCaller, cityId: string): Promise<WorkerPairingDoc | undefined> {
    if (caller.worker === undefined) {
        return undefined;
    }
    const pairing = await reader.get(FIRESTORE_PATHS.pairing(cityId, caller.worker.pair), workerPairingDocSchema);
    if (!standing(pairing, caller.uid)) {
        throw new ApiError('apiError.worker.revoked');
    }
    return pairing;
}

/** Every `worker.*` handler of a paired worker runs only while its pairing stands (Disconnect this computer stops it). */
export function paired<N extends CallableName, D extends Pick<Ports, 'documents'>>(handler: CallableHandler<N, D>): CallableHandler<N, D> {
    return async (deps, caller, request) => {
        await requirePairing(deps.documents, caller, (request as { readonly cityId: string }).cityId);
        return handler(deps, caller, request);
    };
}

/** What a worker knows of the images: the installed one, its own (its pairing's), and whether they differ. */
export interface ImageState {
    readonly installed: string | undefined;
    readonly own: string | undefined;
    readonly outdated: boolean;
}

/**
 * The installed image beside the worker's own: outdated only when both are known and differ. The worker's own is the one
 * it says it runs (`reported`: finding 72, the starter's supervisor names the image it pulled, and a kept pairing outlives
 * many images), else its pairing's command's.
 */
export async function imageState(deps: InstalledImageDeps, caller: VerifiedCaller, cityId: string, reported?: string): Promise<ImageState> {
    const pairing = await requirePairing(deps.documents, caller, cityId);
    const installed = (await installedImage(deps))?.digest;
    return compared(installed, reported ?? pairing?.image);
}

/** Outdated only when both images are known and differ. */
function compared(installed: string | undefined, own: string | undefined): ImageState {
    return { installed, own, outdated: installed !== undefined && own !== undefined && own !== installed };
}
