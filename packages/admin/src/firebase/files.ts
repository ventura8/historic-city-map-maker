/**
 * `FilePort` (`../imagery/files.ts`) over Firebase Storage: `getBlob` reads an object of the private bucket with the
 * admin's own credentials (the Storage rules let admins read the raster folders, `docs/research/M3-interfaces.md` §2.7);
 * a `blob:` address is made of it for an image, and a download saves it under a name through a link the adapter clicks
 * (the Studio file, §7.5). Only this folder imports the Firebase SDK (dependency-cruiser
 * `admin-firebase-sdk-only-in-adapters`); the imagery screens and their node tests see the port.
 */
import type { Logger } from '@hcm/shared';
import { getBlob, ref, type FirebaseStorage, type StorageReference } from 'firebase/storage';

import type { FilePort } from '../imagery/files.js';

/** The SDK functions the adapter calls, passed in so the node tests use a fake table. */
export interface FilesSdk {
    ref(storage: FirebaseStorage, path: string): StorageReference;
    getBlob(reference: StorageReference): Promise<Blob>;
}

export const FILES_SDK: FilesSdk = { ref, getBlob };

/** What the adapter needs of the page. */
export interface FileScope {
    readonly URL: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };
    readonly document: { createElement(tag: 'a'): { href: string; download: string; click(): void } };
    setTimeout(callback: () => void, delay: number): unknown;
}

/** A downloaded file's address is freed after this long (the browser has started saving it by then). */
const RELEASE_AFTER_MS = 60_000;

export function firebaseFiles(sdk: FilesSdk, storage: () => FirebaseStorage, scope: FileScope, log: Logger): FilePort {
    const read = async (path: string): Promise<Blob | null> => {
        try {
            return await sdk.getBlob(sdk.ref(storage(), path));
        } catch (error) {
            log.warn('a file of the private bucket could not be read', { path, error: String(error) });
            return null;
        }
    };
    return {
        read,
        url: async (path) => {
            const blob = await read(path);
            return blob === null ? null : scope.URL.createObjectURL(blob);
        },
        release: (url) => {
            scope.URL.revokeObjectURL(url);
        },
        save: async (path, name) => {
            const blob = await read(path);
            if (blob === null) {
                return false;
            }
            const url = scope.URL.createObjectURL(blob);
            const link = scope.document.createElement('a');
            link.href = url;
            link.download = name;
            link.click();
            scope.setTimeout(() => {
                scope.URL.revokeObjectURL(url);
            }, RELEASE_AFTER_MS);
            return true;
        },
    };
}
