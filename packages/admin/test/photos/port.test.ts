// The photos store must satisfy the structural port its page reads (`@hcm/ui/admin`'s `PhotosAreaPort`) and the
// content seam's module type: a change on either side that breaks the other fails `tsc` here.
import type { PhotosAreaPort } from '@hcm/ui/admin';
import { describe, expect, it } from 'vitest';

import type { AreaModule, ContentModules } from '../../src/content/areas.js';
import type { ContentServices } from '../../src/content/services.js';
import type { PHOTOS_MODULE, PhotosIntents, PhotosServices, PhotosState, PhotosStore } from '../../src/photos/module.js';

type Assignable<Source, Target> = [Source] extends [Target] ? true : false;

const STORE_SATISFIES_PORT: Assignable<PhotosStore, PhotosAreaPort> = true;
const MODULE_IS_AN_AREA_MODULE: Assignable<typeof PHOTOS_MODULE, NonNullable<ContentModules['photos']>> = true;
const SERVICES_SUFFICE: Assignable<ContentServices, PhotosServices> = true;
const MODULE_TYPED: Assignable<
    AreaModule<PhotosState, PhotosIntents>['area'],
    | 'review'
    | 'contribute'
    | 'stories'
    | 'photos'
    | 'pois'
    | 'layers'
    | 'settings'
    | 'admins'
    | 'history'
    | 'jobs'
    | 'crashes'
    | 'home'
    | 'imagery'
    | 'georef'
    | 'help'
    | 'inbox'
    | 'cities'
> = true;

describe('the photos ports', () => {
    it('happyPath_theStoreSatisfiesThePagesPort', () => {
        expect([STORE_SATISFIES_PORT, MODULE_IS_AN_AREA_MODULE, SERVICES_SUFFICE, MODULE_TYPED]).toEqual([true, true, true, true]);
    });
});
