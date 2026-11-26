import type { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
    adminDocSchema,
    inviteDocSchema,
    ownerDocSchema,
    jobDocSchema,
    jobLogDocSchema,
    manifestStateDocSchema,
    opsGuardDocSchema,
    setupStatusDocSchema,
    usageDocSchema,
    usgsSceneDocSchema,
} from '../../src/schemas/firestore-ops.js';
import { setupStatusReadSchema } from '../../src/schemas/legacy-reads.js';
import { validate, type ValidationResult } from '../../src/schemas/validation.js';

function check(schema: z.ZodType, doc: unknown): ValidationResult<unknown> {
    return validate(schema, doc);
}

const now = { seconds: 1_760_000_000, nanoseconds: 0 };
const stamp = { updatedBy: 'system:ops', updatedAt: now };

const docs = {
    job: {
        type: 'usgs-import',
        status: 'running',
        params: { entityId: 'DS1035' },
        createdBy: 'uid-admin',
        createdAt: now,
        step: 'warp',
        progress: 0.4,
        dispatchAt: now,
        machine: 'xl',
        attempt: 1,
        lease: { owner: 'raster-pipeline-xl-abc/0', until: now },
        steps: { fetch: { status: 'done', gcsPath: 'usgs-raw/DS1035.tgz', generation: '1760000000123456', sha256: 'a'.repeat(64) } },
        ...stamp,
    },
    log: { seq: 12, level: 'warn', step: 'fetch', message: 'USGS answered 503, retrying at 09:30', ...stamp },
    scene: {
        entityId: 'DS1035-1057DA023',
        dataset: 'corona2',
        sensor: 'KH-4A',
        acquisitionDate: '1966-07-12',
        status: 'candidate',
        downloadAvailable: true,
        footprint: [
            { lat: 44, lng: 26 },
            { lat: 44.5, lng: 26 },
            { lat: 44.5, lng: 26.5 },
        ],
        resolutionM: 2.75,
        coverage: 0.8,
        browse: { state: 'none', sourceUrl: 'https://ims.cr.usgs.gov/browse/declass1/DS1035-1057DA023.jpg' },
        rank: { score: 81, reasons: [{ code: 'free' }, { code: 'targetYear', params: { year: '1966' } }], version: 1 },
        harvestedAt: now,
        ...stamp,
    },
    setup: {
        billing: {
            state: 'ok',
            checkedAt: now,
            budgetId: 'billingAccounts/0123AB-4567CD-89EF01/budgets/abc-123',
            budgetAmount: 5,
            currency: 'USD',
        },
        provision: {
            state: 'invalid',
            items: [{ id: 'buckets', state: 'missing', detail: 'apiError.cloud.apiDisabled', params: { api: 'storage' } }],
        },
        mapbox: {
            state: 'ok',
            checkedAt: now,
            user: 'ventura86',
            scopes: ['styles:read', 'tokens:write'],
            tilesTokenId: 'ck1tiles',
            adminToken: 'pk.test-admin-token',
            adminTokenId: 'ck2admin',
            adminAllowedUrls: ['https://bucurestiul-disparut.web.app'],
            retiring: [{ tokenId: 'ck0old', retireAt: now }],
        },
        usgs: { state: 'pending', role: 'search', nextCheckAt: now },
        analytics: { state: 'ok', measurementId: 'G-TEST1234', appId: '1:123:web:abc123' },
        crash: { state: 'ok', lastReportAt: now },
        secretsRev: 3,
        ...stamp,
    },
    admin: { role: 'owner', email: 'owner@example.test', displayName: 'Owner', createdAt: now, ...stamp },
    invite: { role: 'admin', invitedBy: 'uid-owner', createdAt: now, expiresAt: now, ...stamp },
    owner: { uid: 'uid-owner', claimedAt: now, ...stamp },
    usage: { month: '2026-10', computeUnits: 12.5, computeUnitBudget: 20, uploadedMb: 300, publishes: 2, ...stamp },
    guard: {
        state: 'red',
        reason: 'budget',
        since: now,
        lastTick: {
            ranAt: now,
            steps: [
                { step: 'guard', ok: true },
                { step: 'health', ok: false, detail: 'apiError.usgs.maintenance' },
            ],
        },
        ...stamp,
    },
    manifest: {
        requestedVersion: 7,
        builtVersion: 6,
        status: 'queued',
        builtAt: now,
        url: 'https://storage.googleapis.com/bucurestiul-disparut-public/cities/bucuresti/manifest.json',
        sha256: 'b'.repeat(64),
        bytes: 61_000,
        counts: { layers: 0, photos: 45, pois: 4, poiCategories: 3 },
        skipped: [{ entity: 'photo', id: 'broken', code: 'validation.outsideCity', path: 'location' }],
        ...stamp,
    },
};

describe('Firestore operational documents: happy paths', () => {
    it.each([
        ['job', jobDocSchema, docs.job],
        ['job log line', jobLogDocSchema, docs.log],
        ['usgsScene', usgsSceneDocSchema, docs.scene],
        ['setup status', setupStatusDocSchema, docs.setup],
        ['an empty setup status', setupStatusDocSchema, stamp],
        ['admin', adminDocSchema, docs.admin],
        ['invitation', inviteDocSchema, docs.invite],
        ['owner', ownerDocSchema, docs.owner],
        ['Mapbox usage', usageDocSchema, docs.usage],
        ['guard', opsGuardDocSchema, docs.guard],
        ['manifest state', manifestStateDocSchema, docs.manifest],
    ] as const)('happyPath_%s', (_name, schema, doc) => {
        expect(check(schema, doc)).toMatchObject({ ok: true });
    });
});

describe('Firestore operational documents: bad paths', () => {
    it.each([
        ['a job without a stamp', jobDocSchema, { ...docs.job, updatedBy: undefined }, 'updatedBy', 'validation.required'],
        ['an unknown job type', jobDocSchema, { ...docs.job, type: 'delete-everything' }, 'type', 'validation.value'],
        ['a job progress over 1', jobDocSchema, { ...docs.job, progress: 2 }, 'progress', 'validation.tooBig'],
        ['an unknown machine', jobDocSchema, { ...docs.job, machine: 'gpu' }, 'machine', 'validation.value'],
        ['a step name with spaces', jobDocSchema, { ...docs.job, step: 'warp it' }, 'step', 'validation.format'],
        [
            'too many recorded steps',
            jobDocSchema,
            { ...docs.job, steps: Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`s${String(index)}`, { status: 'done' }])) },
            'steps',
            'validation.tooBig',
        ],
        ['a log line of an unknown level', jobLogDocSchema, { ...docs.log, level: 'debug' }, 'level', 'validation.value'],
        ['a scene without a stamp', usgsSceneDocSchema, { ...docs.scene, updatedAt: undefined }, 'updatedAt', 'validation.required'],
        [
            'a footprint of two points',
            usgsSceneDocSchema,
            { ...docs.scene, footprint: docs.scene.footprint.slice(0, 2) },
            'footprint',
            'validation.tooSmall',
        ],
        ['an unknown USGS dataset', usgsSceneDocSchema, { ...docs.scene, dataset: 'declassi' }, 'dataset', 'validation.value'],
        ['a secret in setup status', setupStatusDocSchema, { ...docs.setup, mapboxToken: 'sk.x' }, 'mapboxToken', 'validation.unknownKey'],
        [
            'a secret token as the admin token',
            setupStatusDocSchema,
            { ...docs.setup, mapbox: { state: 'ok', adminToken: 'sk.secret-scenario' } },
            'mapbox.adminToken',
            'validation.format',
        ],
        ['an unknown service state', setupStatusDocSchema, { ...docs.setup, usgs: { state: 'waiting' } }, 'usgs.state', 'validation.value'],
        [
            'a detail that is free text',
            setupStatusDocSchema,
            { ...docs.setup, crash: { state: 'invalid', detail: 'it broke' } },
            'crash.detail',
            'validation.value',
        ],
        [
            'an unknown provisioning item',
            setupStatusDocSchema,
            { ...docs.setup, provision: { state: 'ok', items: [{ id: 'mainframe', state: 'ok' }] } },
            'provision.items[0].id',
            'validation.value',
        ],
        [
            'a malformed budget id',
            setupStatusDocSchema,
            { ...docs.setup, billing: { state: 'ok', budgetId: 'my-budget' } },
            'billing.budgetId',
            'validation.format',
        ],
        ['an invalid admin e-mail', adminDocSchema, { ...docs.admin, email: 'not-an-address' }, 'email', 'validation.format'],
        ['a timestamp as a string', adminDocSchema, { ...docs.admin, createdAt: '2026-10-12' }, 'createdAt', 'validation.type'],
        ['an invitation to become owner', inviteDocSchema, { ...docs.invite, role: 'owner' }, 'role', 'validation.value'],
        ['an owner record with an address', ownerDocSchema, { ...docs.owner, email: 'o@example.test' }, 'email', 'validation.unknownKey'],
        [
            'an invitation that stores the address',
            inviteDocSchema,
            { ...docs.invite, email: 'a@example.test' },
            'email',
            'validation.unknownKey',
        ],
        ['a usage month 13', usageDocSchema, { ...docs.usage, month: '2026-13' }, 'month', 'validation.format'],
        ['negative compute units', usageDocSchema, { ...docs.usage, computeUnits: -1 }, 'computeUnits', 'validation.tooSmall'],
        ['an unknown guard state', opsGuardDocSchema, { ...docs.guard, state: 'amber' }, 'state', 'validation.value'],
        [
            'an unknown tick step',
            opsGuardDocSchema,
            { ...docs.guard, lastTick: { ranAt: now, steps: [{ step: 'mine', ok: true }] } },
            'lastTick.steps[0].step',
            'validation.value',
        ],
        [
            'a manifest at an http URL',
            manifestStateDocSchema,
            { ...docs.manifest, url: 'http://example.org/m.json' },
            'url',
            'validation.httpsOnly',
        ],
        [
            'a skipped city',
            manifestStateDocSchema,
            { ...docs.manifest, skipped: [{ ...docs.manifest.skipped[0], entity: 'city' }] },
            'skipped[0].entity',
            'validation.value',
        ],
        [
            'a skip reason that is no validation code',
            manifestStateDocSchema,
            { ...docs.manifest, skipped: [{ ...docs.manifest.skipped[0], code: 'apiError.internal' }] },
            'skipped[0].code',
            'validation.value',
        ],
    ] as const)('badPath_%s', (_name, schema, doc, path, code) => {
        const result = check(schema, doc);

        expect(result.ok ? [] : result.issues).toContainEqual({ path, code });
    });
});

describe('Firestore operational documents: the M3 fields', () => {
    it.each([
        [
            'a browse address outside USGS',
            usgsSceneDocSchema,
            { ...docs.scene, browse: { state: 'none', sourceUrl: 'https://example.org/browse/a.jpg' } },
            'browse.sourceUrl',
            'validation.format',
        ],
        [
            'a browse address that climbs out of its folder',
            usgsSceneDocSchema,
            { ...docs.scene, browse: { state: 'none', sourceUrl: 'https://ims.cr.usgs.gov/browse/../secret.jpg' } },
            'browse.sourceUrl',
            'validation.format',
        ],
        [
            'a score over 100',
            usgsSceneDocSchema,
            { ...docs.scene, rank: { ...docs.scene.rank, score: 101 } },
            'rank.score',
            'validation.tooBig',
        ],
        ['a wait reason nobody knows', jobDocSchema, { ...docs.job, waitReason: 'coffee' }, 'waitReason', 'validation.value'],
        [
            'a reservation map past 50 publishes',
            usageDocSchema,
            {
                ...docs.usage,
                reservations: Object.fromEntries(
                    Array.from({ length: 51 }, (_, index) => [`v${String(index)}`, { computeUnits: 1, at: now }]),
                ),
            },
            'reservations',
            'validation.tooBig',
        ],
    ] as const)('badPath_%s', (_name, schema, doc, path, code) => {
        expect(check(schema, doc)).toEqual({ ok: false, issues: [{ path, code }] });
    });
});

// Finding of 2026-11-12: an install record stored with Firestore timestamps failed the whole document, hiding USGS from Imagery.
describe('setup/status as a reader takes it', () => {
    const install = { server: { state: 'installed', checkedAt: now } };

    it('happyPath_aMalformedAreaReadsAsAbsentAndTheOthersAnswer @S-A11-HAPPY-USGS-BESIDE-BAD-AREA', () => {
        const stored = { ...stamp, usgs: { state: 'ok', role: 'download' }, install, retired: true };

        expect(check(setupStatusDocSchema, stored)).toMatchObject({ ok: false });
        expect(check(setupStatusReadSchema, stored)).toEqual({ ok: true, value: { ...stamp, usgs: { state: 'ok', role: 'download' } } });
    });

    it('badPath_aMalformedStampIsStillRefused @S-A11-BAD-USGS-RECORD-MALFORMED', () => {
        expect(check(setupStatusReadSchema, { usgs: { state: 'ok' }, updatedBy: 'system:ops' })).toMatchObject({ ok: false });
        expect(check(setupStatusReadSchema, { ...stamp, usgs: { state: 'bogus' } })).toEqual({ ok: true, value: stamp });
    });
});
