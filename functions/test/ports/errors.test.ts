import { describe, expect, it } from 'vitest';

import { InvalidDocumentError, UpstreamError } from '../../src/ports/errors.js';

describe('UpstreamError', () => {
    it('happyPath_namesTheServiceTheFailureAndTheStatus', () => {
        const error = new UpstreamError('usgs', 'maintenance', { status: 503, retryAfterSeconds: 1800 });

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('UpstreamError');
        expect(error.message).toBe('usgs call failed: maintenance (HTTP 503)');
        expect([error.service, error.failure, error.status, error.retryAfterSeconds]).toEqual(['usgs', 'maintenance', 503, 1800]);
    });

    it('badPath_aNetworkFailureHasNoStatus', () => {
        const error = new UpstreamError('mapbox', 'unavailable');

        expect(error.message).toBe('mapbox call failed: unavailable');
        expect([error.status, error.retryAfterSeconds]).toEqual([undefined, undefined]);
    });
});

describe('InvalidDocumentError', () => {
    it('badPath_carriesThePathAndTheIssuesButNoValues', () => {
        const error = new InvalidDocumentError('setup/status', [{ path: 'mapbox.state', code: 'validation.value' }]);

        expect(error.name).toBe('InvalidDocumentError');
        expect(error.message).toBe('setup/status is not a valid document (1 issues)');
        expect(error.issues).toEqual([{ path: 'mapbox.state', code: 'validation.value' }]);
        expect(error.path).toBe('setup/status');
    });
});
