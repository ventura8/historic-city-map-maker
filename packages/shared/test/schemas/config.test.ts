import { describe, expect, it } from 'vitest';

import { DEFAULT_CONTAINER_SELECTOR, engineConfigSchema } from '../../src/schemas/config.js';
import { validate } from '../../src/schemas/validation.js';
import { validManifest } from '../fixtures/manifest.js';

describe('engine configuration', () => {
    it.each([
        [{ manifestUrl: 'https://storage.googleapis.com/x-public/cities/bucuresti/manifest.json', cityId: 'bucuresti' }],
        [{ manifestUrl: 'manifest.static.json', lang: 'ro-RO', container: '#map', engineBase: 'https://cdn.jsdelivr.net/gh/o/r@1/dist/' }],
        [{ manifest: validManifest(), lang: 'en' }],
    ])('happyPath_%j_isValid', (config) => {
        expect(validate(engineConfigSchema, config).ok).toBe(true);
    });

    it('happyPath_defaultContainer', () => {
        expect(DEFAULT_CONTAINER_SELECTOR).toBe('#historic-city-map');
    });

    it.each([
        ['neither source', {}, '', 'validation.manifestSource'],
        ['both sources', { manifestUrl: 'm.json', manifest: {} }, '', 'validation.manifestSource'],
        ['an http manifest', { manifestUrl: 'http://example.org/m.json' }, 'manifestUrl', 'validation.assetUrl'],
        ['an invalid city id', { manifestUrl: 'm.json', cityId: 'bad id' }, 'cityId', 'validation.format'],
        ['a malformed language', { manifestUrl: 'm.json', lang: 'romanian please' }, 'lang', 'validation.format'],
        [
            'an engine base without a slash',
            { manifestUrl: 'm.json', engineBase: 'https://cdn.example.org/dist' },
            'engineBase',
            'validation.format',
        ],
        ['an empty container', { manifestUrl: 'm.json', container: '  ' }, 'container', 'validation.tooSmall'],
        ['an unknown key', { manifestUrl: 'm.json', token: 'pk.x' }, 'token', 'validation.unknownKey'],
    ])('badPath_%s', (_name, config, path, code) => {
        const result = validate(engineConfigSchema, config);

        expect(result.ok ? [] : result.issues).toContainEqual({ path, code });
    });
});
