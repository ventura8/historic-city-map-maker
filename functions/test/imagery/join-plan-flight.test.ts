/**
 * One rewrite of a city's plan at a time (`functions/src/imagery/join-plan.ts`): `imagery-onJobWrite` ran out of its 256 MiB when
 * three frames ended together and each read the whole city (Cloud Error Reporting, 2026-11-13; docs/LESSONS.md 663). Calls that
 * come while a rewrite runs share one more rewrite, which starts after them, so the plan still shows what they wrote.
 */
import { FIRESTORE_PATHS, datePlanDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { rewriteDatePlan } from '../../src/imagery/join-plan.js';
import { EAST, F039, F040, frameFields } from './join-world.js';
import { CITY, readyWorld, seedScene, type ImageryWorld } from './world.js';

interface Gate {
    readonly open: () => void;
    readonly reads: () => number;
}

/** Counts the reads of the city's versions; the first waits until `open()`, so the test knows a rewrite is under way. */
function gateVersionReads(world: ImageryWorld): Gate {
    const documents = world.deps.documents;
    const query = documents.query.bind(documents);
    let reads = 0;
    let open = (): void => undefined;
    const opened = new Promise<void>((resolve) => {
        open = resolve;
    });
    documents.query = async (path, schema, options) => {
        if (path === FIRESTORE_PATHS.layerVersions(CITY)) {
            reads += 1;
            await (reads === 1 ? opened : Promise.resolve());
        }
        return query(path, schema, options);
    };
    return {
        open: () => {
            open();
        },
        reads: () => reads,
    };
}

function planFrames(world: ImageryWorld) {
    return world.deps.documents.get(FIRESTORE_PATHS.imageryPlan(CITY), datePlanDocSchema).then((plan) => plan?.rows[0]?.frames ?? []);
}

describe('one rewrite of a city plan at a time', () => {
    it('badPath_threeFramesEndingTogetherReadTheCityTwice_thePlanShowsTheLastWrite @S-A66-BAD-REWRITES-AT-ONCE', async () => {
        const world = await readyWorld();
        await seedScene(world, F039, frameFields());
        const gate = gateVersionReads(world);

        const first = rewriteDatePlan(world.deps, CITY);
        // A frame written while the first rewrite reads: the calls after it must see it.
        await seedScene(world, F040, frameFields({ footprint: EAST }));
        const later = [rewriteDatePlan(world.deps, CITY), rewriteDatePlan(world.deps, CITY)];
        gate.open();
        await Promise.all([first, ...later]);

        expect(gate.reads()).toBe(2);
        expect((await planFrames(world)).map((frame) => frame.entityId).sort((a, b) => a.localeCompare(b))).toEqual([F039, F040]);
    });

    it('badPath_aRewriteThatFailsFailsItsWaiters_theNextCallReadsAgain', async () => {
        const world = await readyWorld();
        await seedScene(world, F039, frameFields());
        await seedScene(world, F040, frameFields({ footprint: EAST }));
        const gate = gateVersionReads(world);
        const write = world.deps.documents.set.bind(world.deps.documents);
        let refuse = true;
        world.deps.documents.set = (path, schema, data) =>
            refuse && path === FIRESTORE_PATHS.imageryPlan(CITY) ? Promise.reject(new Error('plan refused')) : write(path, schema, data);

        const first = rewriteDatePlan(world.deps, CITY);
        const waiter = rewriteDatePlan(world.deps, CITY);
        gate.open();
        await expect(first).rejects.toThrow('plan refused');
        await expect(waiter).rejects.toThrow('plan refused');

        refuse = false;
        await rewriteDatePlan(world.deps, CITY);
        expect(gate.reads()).toBe(2);
        expect(await planFrames(world)).toHaveLength(2);
    });

    it('happyPath_twoCitiesRewriteSideBySide', async () => {
        const world = await readyWorld();
        await seedScene(world, F039, frameFields());
        await seedScene(world, F040, frameFields({ footprint: EAST }));
        const gate = gateVersionReads(world);

        const city = rewriteDatePlan(world.deps, CITY);
        // Another city's call is not held behind this one (a city that does not exist writes nothing and returns at once).
        await rewriteDatePlan(world.deps, 'elsewhere');
        gate.open();
        await city;

        expect(gate.reads()).toBe(1);
        expect(await planFrames(world)).toHaveLength(2);
    });
});
