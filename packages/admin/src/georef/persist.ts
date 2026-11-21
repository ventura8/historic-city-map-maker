/**
 * Save and Snap for the georeferencer store (`imagery.saveGcps`, M16 snap chunk).
 */
import type { Gcp, GeorefTransform } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import { callImagery, refusalOf } from '../imagery/api.js';
import type { Store } from '../state/store.js';
import { snapOf, type ExtrasLoader } from './extras.js';
import type { OwnFit } from './fit-view.js';
import type { PairHistory } from './history.js';
import { saveRequestOf } from './save-request.js';
import type { GeorefState } from './state.js';

export interface PersistBase {
    readonly pairs: readonly Gcp[];
    readonly transform: GeorefTransform;
}

export interface PersistHost {
    readonly services: ContentServices;
    readonly cell: Store<GeorefState>;
    readonly history: PairHistory;
    readonly extras: ExtrasLoader;
    base(): PersistBase;
    setBase(value: PersistBase): void;
    own(): OwnFit | null;
    setOwn(value: OwnFit | null): void;
    refit(pairs: readonly Gcp[], transform: GeorefTransform): void;
}

/** Saves the current pairs; returns whether the callable accepted them. */
export async function saveGeoref(host: PersistHost): Promise<boolean> {
    const request = saveRequestOf(host.services.cityId, host.cell.state);
    if (request === null) {
        return false;
    }
    host.cell.update({ saving: true, refusal: null });
    try {
        const answer = await callImagery(host.services.callables, 'imagery.saveGcps', request);
        host.setBase({ pairs: host.cell.state.pairs, transform: request.transform });
        host.setOwn(null);
        host.history.clear();
        host.cell.update({ saving: false, dirty: false, canUndo: false, saved: answer.versionId });
        host.services.notify({ key: answer.resumed ? 'adminContent.georef.savedResumed' : 'adminContent.georef.savedNew' });
        return true;
    } catch (error) {
        host.cell.update({ saving: false, refusal: refusalOf(error) });
        return false;
    }
}

/** M16 Snap my points; reopens the version they make when saved. */
export async function snapGeoref(host: PersistHost): Promise<boolean> {
    host.cell.update({ saving: true, refusal: null });
    const base = host.base();
    const outcome = await snapOf(host.services, host.extras, { ...host.cell.state, base: base.pairs });
    if (outcome.saved !== null) {
        host.refit(base.pairs, base.transform);
    }
    host.cell.update({ saving: false, ...outcome });
    return outcome.saved !== null;
}
