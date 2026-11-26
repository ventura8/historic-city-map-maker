import { createLogger } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import type { FirebaseStorage, StorageReference } from 'firebase/storage';
import { describe, expect, it } from 'vitest';

import { firebaseFiles, type FileScope, type FilesSdk } from '../../src/firebase/files.js';

function world(blobs: Readonly<Record<string, Blob>>) {
    const recording = createRecordingSink();
    const calls: string[] = [];
    const timers: (() => void)[] = [];
    const sdk: FilesSdk = {
        ref: (_storage, path) => ({ fullPath: path }) as unknown as StorageReference,
        getBlob: (reference) => {
            const blob = blobs[(reference as unknown as { fullPath: string }).fullPath];
            return blob === undefined ? Promise.reject(new Error('storage/object-not-found')) : Promise.resolve(blob);
        },
    };
    const scope: FileScope = {
        URL: {
            createObjectURL: () => 'blob:1',
            revokeObjectURL: (url) => calls.push(`revoke ${url}`),
        },
        document: {
            createElement: () => {
                const link = { href: '', download: '', click: () => calls.push(`click ${link.href} ${link.download}`) };
                return link;
            },
        },
        setTimeout: (callback) => timers.push(callback),
    };
    const files = firebaseFiles(sdk, () => ({}) as FirebaseStorage, scope, createLogger('files-test', { sink: recording.sink }));
    return { files, calls, timers, recording };
}

describe('the private bucket files', () => {
    it('happyPath_aFileIsReadMadeAnAddressAndSavedUnderItsName', async () => {
        const { files, calls, timers } = world({ 'rasters/x/studio.tif': new Blob(['tiff']) });

        const blob = await files.read('rasters/x/studio.tif');
        const url = await files.url('rasters/x/studio.tif');
        files.release('blob:old');
        const saved = await files.save('rasters/x/studio.tif', 'hcm-bucharest-x.tif');
        for (const timer of timers) {
            timer();
        }

        expect([await blob?.text(), url, saved]).toEqual(['tiff', 'blob:1', true]);
        expect(calls).toEqual(['revoke blob:old', 'click blob:1 hcm-bucharest-x.tif', 'revoke blob:1']);
    });

    it('badPath_aMissingOrRefusedFileIsNoneAndIsLogged', async () => {
        const { files, calls, recording } = world({});

        expect([await files.read('missing'), await files.url('missing'), await files.save('missing', 'x.tif')]).toEqual([
            null,
            null,
            false,
        ]);
        expect(calls).toEqual([]);
        expect(recording.records.at(-1)).toMatchObject({ level: 'warn', message: 'a file of the private bucket could not be read' });
    });
});
