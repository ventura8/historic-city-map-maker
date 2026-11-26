import { createLogger } from '@hcm/shared';
import type { APIRequestContext } from '@playwright/test';

import type { CityWorld } from '../admin/support/content.js';
import type { SignedInAccount } from '../admin/support/emulators.js';
import { ImageryWorld } from '../admin/support/imagery.js';
import type { ImageryScript } from '../admin/support/imagery-runner.js';
import { UpstreamControl } from '../admin/support/upstream.js';
import { callable } from './callable.js';

/**
 * The local stack's M3 and M4 imagery (docs/SETUP.md → *Local stack for manual testing*), made through the real flows:
 * the owner's `imagery.search` harvests and ranks the fake USGS catalogue over the city, then four of Bucharest's target
 * frames are imported with `imagery.import`, each run played by the e2e world's stand-in runner (scripted per city,
 * e2e/admin/support/imagery-runner.ts): one over the RMSE threshold (a draft waiting for Approve), one with too few
 * confident pairs (the georeferencer's job, with the matcher's suggestions to accept or reject: M4), one failed at warp
 * (Retry), and one under the threshold, which the policy approves and the fake MTS publishes in the background. The
 * runner's script is then left at "under the threshold", so the tester's own imports and retries publish. M4's orders:
 * the 1968 Corona frame USGS has not scanned stays one to buy (its preview in our bucket: the fake browse host never
 * serves it), and the Declass 3 frame is marked as ordered with `usgs.markOrdered`, so the watch's card is there. The
 * failed import, the draft over the threshold and the version waiting for points each reach every admin's inbox through
 * the server's own events (`notify.onEvent`).
 */

const log = createLogger('dev-stack-seed');

/** Bucharest's target frames of the fake USGS (e2e/admin/specs/imagery/world.ts → `TARGET_FRAMES`). */
const FRAMES = {
    approval: 'DS1035-1057DA023',
    points: 'DZB1211-500043L007001',
    failed: 'DZB1213-500159L010001',
    published: 'D3C1216-200467A021',
} as const;

/** The two frames USGS has not scanned (e2e/admin/specs/imagery/world.ts → `PAID_FRAMES`): one to buy, one ordered. */
const ORDERS = { toBuy: 'DS1105-1071DF076', ordered: 'D3C1209-100055F012' } as const;

/** When the preview of the frame to buy was copied (fixed: never the wall clock). */
const PREVIEW_AT = new Date('2026-10-20T09:00:00.000Z');

const POLL_MS = 1000;
const IMPORT_TIMEOUT_MS = 120_000;
/** The fake MTS's job is first polled a minute after the publish starts, then the manifest is built. */
const PUBLISH_TIMEOUT_MS = 300_000;

function pause(ms: number): Promise<void> {
    return new Promise((done) => {
        setTimeout(done, ms);
    });
}

/** Polls `read` until `done` holds for its value, or throws after `timeout` naming `what` and the last value. */
async function until<T>(what: string, read: () => Promise<T>, done: (value: T) => boolean, timeout: number): Promise<T> {
    const deadline = Date.now() + timeout;
    let value = await read();
    while (!done(value)) {
        if (Date.now() > deadline) {
            throw new Error(`${what}: still ${JSON.stringify(value)} after ${String(timeout / 1000)} s`);
        }
        await pause(POLL_MS);
        value = await read();
    }
    return value;
}

export interface ImagerySeed {
    /** Resolves once the frame published in the background is on the public map (or failed to). */
    readonly published: Promise<void>;
}

export class StackImagery {
    readonly #api: APIRequestContext;
    readonly #owner: SignedInAccount;
    readonly #imagery: ImageryWorld;

    constructor(api: APIRequestContext, world: CityWorld, owner: SignedInAccount) {
        this.#api = api;
        this.#owner = owner;
        // The stack has one partition of the fake upstreams, `''`: the browser's and the server's.
        this.#imagery = new ImageryWorld(api, world, new UpstreamControl(api, ''));
    }

    /** The fake USGS harvested over the city by the owner, ranked by the server. */
    async harvest(): Promise<void> {
        const result = await callable(this.#api, this.#owner, 'imagery.search', { cityId: this.#imagery.city });
        log.info('USGS harvest', { found: result['found'], added: result['added'] });
    }

    /** Imports `entityId` with the runner scripted to `script`; the version's id. */
    async #import(entityId: string, script: ImageryScript): Promise<string> {
        await this.#imagery.script(script);
        const result = await callable(this.#api, this.#owner, 'imagery.import', { cityId: this.#imagery.city, entityId });
        return String(result['versionId']);
    }

    async #versionState(versionId: string, states: readonly string[], timeout = IMPORT_TIMEOUT_MS): Promise<void> {
        const read = async (): Promise<unknown> => (await this.#imagery.version(versionId))?.['state'];
        await until(`version ${versionId}`, read, (state) => states.includes(String(state)), timeout);
    }

    /** M4: a frame to buy with its preview, and one marked as ordered (the watch then asks USGS about it daily). */
    async orders(): Promise<void> {
        await this.#imagery.seedBrowse(ORDERS.toBuy, PREVIEW_AT);
        const marked = await callable(this.#api, this.#owner, 'usgs.markOrdered', { cityId: this.#imagery.city, entityId: ORDERS.ordered });
        log.info('a frame to buy, and one marked as ordered', {
            toBuy: ORDERS.toBuy,
            ordered: ORDERS.ordered,
            nextCheckAt: marked['nextCheckAt'],
        });
    }

    /** The four imports, one after the other; the last one publishes in the background. */
    async imports(): Promise<ImagerySeed> {
        const approval = await this.#import(FRAMES.approval, { attempts: [{ outcome: 'over' }] });
        await this.#versionState(approval, ['awaiting_approval']);
        log.info('a draft over the threshold waits for Approve', { scene: FRAMES.approval, version: approval });

        const points = await this.#import(FRAMES.points, { attempts: [{ outcome: 'suggestions' }] });
        await this.#versionState(points, ['needs_gcps']);
        log.info('an import waits for points in the georeferencer, with suggestions', { scene: FRAMES.points, version: points });

        const failed = await this.#import(FRAMES.failed, { attempts: [{ outcome: 'fail', failAt: 'warp' }, { outcome: 'under' }] });
        const read = async (): Promise<unknown> => (await this.#imagery.job(failed))?.['status'];
        await until(`job ${failed}`, read, (status) => status === 'failed', IMPORT_TIMEOUT_MS);
        log.info('an import failed at warp (Retry runs it again)', { scene: FRAMES.failed, job: failed });

        const published = await this.#import(FRAMES.published, { attempts: [{ outcome: 'under' }] });
        log.info('an import under the threshold publishes in the background', { scene: FRAMES.published, version: published });
        const done = this.#versionState(published, ['published'], PUBLISH_TIMEOUT_MS).then(
            () => {
                log.info('the 1980 frame is published (Layers, the admin map and the viewer show it)', { version: published });
            },
            (error: unknown) => {
                log.warn('the background publish did not finish', { error: String(error) });
            },
        );
        return { published: done };
    }
}
