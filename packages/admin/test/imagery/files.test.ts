import { describe, expect, it } from 'vitest';

import { NO_FILES } from '../../src/imagery/files.js';

describe('the imagery files without a bucket', () => {
    it('badPath_everyReadIsUnavailableAndNothingIsSaved', async () => {
        NO_FILES.release('rasters/x/preview.png');

        await expect(NO_FILES.read('rasters/x/preview.png')).resolves.toBeNull();
        await expect(NO_FILES.url('rasters/x/preview.png')).resolves.toBeNull();
        await expect(NO_FILES.save('rasters/x/studio.tif', 'x.tif')).resolves.toBe(false);
    });
});
