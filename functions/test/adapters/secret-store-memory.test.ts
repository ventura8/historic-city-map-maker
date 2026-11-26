import { describe, expect, it } from 'vitest';

import { createMemorySecretStore } from '../../src/adapters/secret-store-memory.js';

describe('createMemorySecretStore', () => {
    it('happyPath_theLatestWriteWins', async () => {
        const secrets = createMemorySecretStore();

        await expect(secrets.write('usgs-app-token', 'one')).resolves.toBe('memory/secrets/usgs-app-token/versions/1');
        await expect(secrets.write('usgs-app-token', 'two')).resolves.toBe('memory/secrets/usgs-app-token/versions/2');
        secrets.invalidate();

        await expect(secrets.read('usgs-app-token')).resolves.toBe('two');
    });

    it('badPath_anUnwrittenSecretIsUnset', async () => {
        await expect(createMemorySecretStore().read('mapbox-sk-bootstrap')).resolves.toBeUndefined();
    });
});
