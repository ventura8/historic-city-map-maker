import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/api/api-error.js';
import { asJoinLayerBusy } from '../../src/imagery/join-busy.js';

describe('asJoinLayerBusy', () => {
    it('happyPath_aBusyLayerBecomesTheJoinsOwnCode', () => {
        expect(() => asJoinLayerBusy(new ApiError('apiError.layers.busy'))).toThrow(
            expect.objectContaining({ code: 'apiError.imagery.joinLayerBusy' }),
        );
    });

    it('badPath_anyOtherFailurePassesThrough', () => {
        expect(() => asJoinLayerBusy(new ApiError('apiError.internal'))).toThrow(expect.objectContaining({ code: 'apiError.internal' }));
        expect(() => asJoinLayerBusy(new Error('gone'))).toThrow('gone');
    });
});
