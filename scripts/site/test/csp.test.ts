import { describe, expect, it } from 'vitest';

import { manifestSchema, type EngineConfig, type Layer, type Manifest } from '@hcm/shared';

import { ANALYTICS_CONNECT_SOURCES, contentSecurityPolicy } from '../src/csp.js';
import { manifestOrigins } from '../src/origins.js';
import { readRepositoryManifest } from './manifests.js';

function directive(policy: string, name: string): string[] {
    const found = policy.split('; ').find((part) => part.startsWith(`${name} `));
    return (found ?? '').split(' ').slice(1);
}

const LOCAL: EngineConfig = { cityId: 'bucuresti', manifestUrl: './data/manifest.json' };

function layer(id: string, source: Layer['source']): Layer {
    return {
        id,
        year: 1966,
        label: { ro: id, en: id },
        kind: 'satellite',
        attribution: 'USGS',
        source,
        minzoom: 10,
        maxzoom: 18,
        order: 0,
        defaultVisible: false,
        opacity: 1,
    };
}

describe('contentSecurityPolicy', () => {
    it('happyPath_lockedDownByDefault', () => {
        const policy = contentSecurityPolicy({ connect: [], images: [] });

        expect(directive(policy, 'default-src')).toEqual(["'none'"]);
        expect(directive(policy, 'script-src')).toEqual([
            "'self'",
            'https://api.mapbox.com/mapbox-gl-js/',
            "'wasm-unsafe-eval'",
            'https://www.googletagmanager.com',
        ]);
        expect(directive(policy, 'style-src')).toEqual(["'self'", 'https://api.mapbox.com/mapbox-gl-js/']);
        expect(directive(policy, 'connect-src')).toEqual([
            "'self'",
            'https://api.mapbox.com',
            'https://events.mapbox.com',
            'https://*.tiles.mapbox.com',
            ...ANALYTICS_CONNECT_SOURCES,
        ]);
        expect(directive(policy, 'worker-src')).toEqual(['blob:', "'self'"]);
        for (const name of ['base-uri', 'form-action', 'object-src']) {
            expect(directive(policy, name)).toEqual(["'none'"]);
        }
    });

    it('badPath_performanceMonitoringHostsAreNotAllowed', () => {
        // The viewer never loads Performance Monitoring, which would send the URL hash (CR-M2-36).
        expect(contentSecurityPolicy({ connect: [], images: [] })).not.toContain('firebaselogging');
    });

    it('happyPath_noInlineCodeAndNoEvalBeyondWebAssembly', () => {
        const policy = contentSecurityPolicy({ connect: [], images: [] });

        expect(policy).not.toContain("'unsafe-inline'");
        expect(policy).not.toContain("'unsafe-eval'");
        expect(policy).not.toContain('upgrade-insecure-requests');
    });

    it('happyPath_extraOriginsJoinOnceEach', () => {
        const policy = contentSecurityPolicy({
            connect: ['https://telemetry.example', 'https://api.mapbox.com'],
            images: ['https://photos.example'],
        });

        expect(directive(policy, 'connect-src').filter((source) => source === 'https://api.mapbox.com')).toHaveLength(1);
        expect(directive(policy, 'connect-src')).toContain('https://telemetry.example');
        expect(directive(policy, 'img-src')).toContain('https://photos.example');
    });
});

describe('manifestOrigins', () => {
    it('happyPath_theBucharestSeedNeedsNothingBeyondTheFixedPolicy', () => {
        expect(manifestOrigins(readRepositoryManifest('seed/bucharest/manifest.static.json'), LOCAL)).toEqual({ connect: [], images: [] });
    });

    it('happyPath_collectsEveryExternalOriginOnce', () => {
        const seed = readRepositoryManifest('seed/bucharest/manifest.static.json');
        const [first, second] = seed.photos;
        const manifest: Manifest = manifestSchema.parse({
            ...seed,
            city: {
                ...seed.city,
                analytics: { errorEndpoint: 'https://telemetry.example/report' },
                basemap: { style: 'https://styles.example/s.json' },
            },
            layers: [
                layer('a', { type: 'mapbox', tilesetId: 'ventura86.a' }),
                layer('b', {
                    type: 'xyz',
                    tiles: ['https://tiles.example/b/{z}/{x}/{y}.png', 'https://tiles.example/c/{z}/{x}/{y}.png'],
                    tileSize: 256,
                }),
                layer('c', { type: 'pmtiles', url: 'https://archives.example/c.pmtiles' }),
                layer('d', { type: 'pmtiles', url: 'archives/d.pmtiles' }),
            ],
            photos: [
                { ...first, image: { ...first?.image, web: 'https://photos.example/1/web.webp', thumb: 'https://thumbs.example/1.webp' } },
                second,
            ],
        });
        const config: EngineConfig = { manifestUrl: 'https://storage.example/city/manifest.json' };

        expect(manifestOrigins(manifest, config)).toEqual({
            connect: [
                'https://archives.example',
                'https://storage.example',
                'https://styles.example',
                'https://telemetry.example',
                'https://tiles.example',
            ],
            images: [
                'https://archives.example',
                'https://photos.example',
                'https://storage.example',
                'https://thumbs.example',
                'https://tiles.example',
            ],
        });
    });

    it('badPath_anInlineManifestHasNoManifestHost', () => {
        const seed = readRepositoryManifest('seed/bucharest/manifest.static.json');

        expect(manifestOrigins(seed, { manifest: {} })).toEqual({ connect: [], images: [] });
    });
});
