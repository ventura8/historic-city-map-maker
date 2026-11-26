/** M13's documents and manifest additions (`docs/research/M13-roles.md` §§2, 5, 6). */
import {
    isReviewCleared,
    notificationAudience,
    photoDocSchema,
    suggestionSubmitRequestSchema,
    timestampFromDate,
    validate,
    validateManifest,
    NOTIFICATION_KINDS,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { validManifest as siteManifestLike } from '../fixtures/manifest.js';

const AT = timestampFromDate(new Date('2026-10-12T08:00:00.000Z'));
const PHOTO = { title: { ro: 'Calea Victoriei' }, license: 'PD', published: false, processing: 'pending', updatedBy: 'u', updatedAt: AT };
const IMAGE = { web: 'https://example.org/w.webp', thumb: 'https://example.org/t.webp', w: 10, h: 10 };
const UNPLACED = { id: 'lost', title: { ro: 'Unde?' }, license: 'PD', links: [], image: IMAGE };

describe('photoDocSchema: a photo with no place', () => {
    it('happyPath_itWaits', () => {
        expect(validate(photoDocSchema, PHOTO).ok).toBe(true);
    });

    it.each([
        ['bearing', { bearing: 90 }],
        ['field of view', { fov: 60 }],
    ])('badPath_aimingItIsMeaningless_%s', (_name, field) => {
        expect(validate(photoDocSchema, { ...PHOTO, ...field }).ok).toBe(false);
    });

    it('happyPath_aimingAPlacedOneIsFine', () => {
        expect(validate(photoDocSchema, { ...PHOTO, location: { lat: 44, lng: 26 }, bearing: 90 }).ok).toBe(true);
    });
});

describe('isReviewCleared', () => {
    it.each([
        [undefined, true],
        ['approved', true],
        ['pending', false],
        ['refused', false],
    ] as const)('%s is cleared: %s', (reviewStatus, cleared) => {
        expect(isReviewCleared({ reviewStatus })).toBe(cleared);
    });
});

describe('the manifest (additive)', () => {
    it('happyPath_aManifestFromBeforeStaysValid', () => {
        expect(validateManifest(siteManifestLike()).ok).toBe(true);
    });

    it('happyPath_theUnplacedListAndTheLink', () => {
        const result = validateManifest({
            ...siteManifestLike(),
            unplaced: [UNPLACED],
            contributeUrl: 'https://demo.web.app/admin/#/contribute/x',
        });
        expect(result.ok).toBe(true);
    });

    it('badPath_aPlacedPhotoStillNeedsItsPlace', () => {
        const manifest = siteManifestLike();
        expect(validateManifest({ ...manifest, photos: [{ ...UNPLACED }] }).ok).toBe(false);
    });

    it('badPath_anUnplacedPhotoCannotCarryAPlace', () => {
        const unplaced = [{ ...UNPLACED, location: { lat: 44.43, lng: 26.09 } }];
        expect(validateManifest({ ...siteManifestLike(), unplaced }).ok).toBe(false);
    });

    it('badPath_aPhotoIsPlacedOrUnplacedNeverBoth', () => {
        const photo = { ...UNPLACED, location: { lat: 44.43, lng: 26.09 } };
        expect(validateManifest({ ...siteManifestLike(), photos: [photo], unplaced: [UNPLACED] }).ok).toBe(false);
        expect(validateManifest({ ...siteManifestLike(), unplaced: [UNPLACED, UNPLACED] }).ok).toBe(false);
    });

    it('badPath_aContributeLinkIsHttps', () => {
        expect(validateManifest({ ...siteManifestLike(), contributeUrl: 'javascript:alert(1)' }).ok).toBe(false);
    });
});

describe('suggestionSubmitRequestSchema', () => {
    const base = { cityId: 'bucharest', photoId: 'p1' };

    it('happyPath_aCorrectionMayAimWithoutMoving', () => {
        const request = { ...base, kind: 'correction', proposal: { bearing: 10 }, reason: 'Se vede biserica.' };
        expect(validate(suggestionSubmitRequestSchema, request).ok).toBe(true);
    });

    it('badPath_aPlaceNeedsALocation', () => {
        expect(validate(suggestionSubmitRequestSchema, { ...base, kind: 'place', proposal: { bearing: 10 } }).ok).toBe(false);
    });
});

describe('notificationAudience', () => {
    it('happyPath_eachKindHasItsAudience', () => {
        const audiences = NOTIFICATION_KINDS.map(notificationAudience);
        expect(audiences.filter((audience) => audience === 'owners')).toHaveLength(1);
        expect(audiences.filter((audience) => audience === 'reviewers')).toHaveLength(2);
        expect(notificationAudience('budget.paused')).toBe('staff');
    });
});
