/**
 * The photos area as the shell creates it (`docs/research/M2c-interfaces.md` §2.1 `AreaModule`): `create` builds the
 * store when the photos page first opens; the shell destroys it on sign-out. The entry wires it into `AdminDeps.content`
 * (ops-screens' seam) with the real services; the node tests create it over fakes.
 */
import type { PhotosServices } from './ports.js';
import { PhotosArea, type PhotosStore } from './store.js';

export interface PhotosModule {
    readonly area: 'photos';
    create(services: PhotosServices): PhotosStore;
}

export const PHOTOS_MODULE: PhotosModule = {
    area: 'photos',
    create: (services) => new PhotosArea(services),
};

export type { PhotosServices } from './ports.js';
export type { PhotosIntents, PhotosStore } from './store.js';
export type { PhotosState } from './state.js';
