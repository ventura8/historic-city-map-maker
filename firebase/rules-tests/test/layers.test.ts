/**
 * cities/{city}/layers/{layer}: created by the pipeline; admins edit the presentation, year and date, default opacity
 * and the image adjustments (`LAYER_ADJUSTMENT_RANGES`), validated like `layerDocSchema`. Server-owned fields:
 * client-writes.test.ts.
 */
import { FIRESTORE_PATHS, LAYER_ADJUSTMENT_RANGES } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { layerDoc } from './support/documents.js';
import { createWorld, deleted, stampedBy, verdict, type Data, type Verdict, type World } from './support/world.js';

const CITY_ID = 'rules-layers';

let world: World;
let sequence = 0;

async function edit(changes: Data, seed: Data = layerDoc()): Promise<Verdict> {
    sequence += 1;
    const path = FIRESTORE_PATHS.layer(CITY_ID, `l${String(sequence)}`);
    await world.seed(path, seed);
    return verdict(
        world
            .db('admin')
            .doc(path)
            .update({ ...stampedBy(world.uid('admin')), ...changes }),
    );
}

const RANGES = Object.entries(LAYER_ADJUSTMENT_RANGES);

beforeAll(async () => {
    world = await createWorld('layers');
});

afterAll(async () => {
    await world.close();
});

describe('presentation', () => {
    it.each([
        [
            'a label, order, visibility and publication',
            { label: { ro: 'București, 1966' }, order: -3, defaultVisible: false, published: false },
        ],
        ['a fully opaque default', { opacity: 1 }],
        ['a removed description, attribution and date', { description: deleted(), attribution: deleted(), date: deleted() }],
        ['a leap day', { date: '1968-02-29' }],
        ['the oldest year', { year: 1800 }],
    ])('happyPath_adminSaves_%s', async (_label, changes) => {
        expect(await edit(changes)).toBe('allow');
    });

    it.each([
        ['a year before 1800', { year: 1799 }],
        ['a fractional year', { year: 1966.5 }],
        ['a date that is not ISO', { date: '20.08.1966' }],
        ['a date in month 13', { date: '1966-13-01' }],
        ['a date with a time', { date: '1966-08-20T10:00:00Z' }],
        ['an opacity over 1', { opacity: 1.5 }],
        ['a negative opacity', { opacity: -0.1 }],
        ['a fractional order', { order: 1.5 }],
        ['a visibility that is not a boolean', { defaultVisible: 'yes' }],
        ['a published flag that is not a boolean', { published: 1 }],
        ['a label over 200 characters', { label: { ro: 'x'.repeat(201) } }],
        ['a label without Romanian', { label: { en: 'Corona 1966' } }],
        ['a removed label', { label: deleted() }],
        ['a description that is not bilingual', { description: { de: 'Luftbild' } }],
        ['an attribution over 500 characters', { attribution: 'x'.repeat(501) }],
        ['another editor', { updatedBy: 'someone-else' }],
    ])('badPath_adminCannotSave_%s', async (_label, changes) => {
        expect(await edit(changes)).toBe('deny');
    });
});

describe('image adjustments', () => {
    it.each(RANGES)('happyPath_%sAcceptsItsWholeRange', async (name, range) => {
        expect(await edit({ adjustments: { [name]: range.min } })).toBe('allow');
        expect(await edit({ adjustments: { [name]: range.max } })).toBe('allow');
    });

    it('happyPath_neutralAdjustmentsCanBeCleared', async () => {
        expect(await edit({ adjustments: {} })).toBe('allow');
        expect(await edit({ adjustments: deleted() })).toBe('allow');
    });

    it.each(RANGES)('badPath_%sRefusesValuesOutsideItsRange', async (name, range) => {
        expect(await edit({ adjustments: { [name]: range.min - 0.01 } })).toBe('deny');
        expect(await edit({ adjustments: { [name]: range.max + 0.01 } })).toBe('deny');
    });

    it.each([
        ['brightness min above max', { brightnessMin: 0.8, brightnessMax: 0.2 }],
        ['brightness min above the neutral max', { brightnessMin: 1.01 }],
        ['gamma, which the viewer does not apply', { gamma: 1.2 }],
        ['a contrast that is text', { contrast: '0.5' }],
    ])('badPath_adminCannotSaveAdjustmentsWith_%s', async (_label, adjustments) => {
        expect(await edit({ adjustments })).toBe('deny');
    });

    it('badPath_adjustmentsMustBeAMap', async () => {
        expect(await edit({ adjustments: [0.1, 0.9] })).toBe('deny');
    });
});
