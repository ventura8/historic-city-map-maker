/**
 * The layer editor's assists (`packages/admin/src/layers/assists.ts`; `docs/research/M4-interfaces.md` §4.1, CR-M4-4)
 * through the layers area: a draft fills the other language of the name or the description in the editor's draft only,
 * a layer has no title to suggest, and another layer forgets the drafts.
 */
import { describe, expect, it } from 'vitest';

import { layersModule } from '../../src/layers/layers.js';
import { contentWorld } from '../content/world.js';
import { CITY_PATH, cityDoc, LAYER_PATH, layerDoc } from './fixtures.js';

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

function open(params: readonly string[]) {
    const world = contentWorld();
    world.store.docs.set(LAYER_PATH('corona'), layerDoc({ label: { ro: 'Corona 1968' }, description: { ro: 'Fotografie.' } }));
    world.store.docs.set(LAYER_PATH('plan'), layerDoc({ label: { ro: 'Planul 1911' } }));
    world.store.docs.set(CITY_PATH, cityDoc());
    world.callables.answer('assist.translateDraft', (request) => {
        const { text, to } = request as { readonly text: string; readonly to: string };
        return { draft: `${text} [${to}]`, truncated: false, model: 'gemini-3.5-flash-lite' };
    });
    const store = layersModule.create(world.services);
    store.open(params);
    return { world, store };
}

describe('the layer editor assists', () => {
    it('happyPath_draftsFillTheNameAndTheDescriptionUntilSave', async () => {
        const { world, store } = open(['corona']);
        store.intents.setField('label.en', 'Corona');
        store.intents.setField('label.ro', '');

        store.intents.draftText('label', 'ro');
        store.intents.draftText('description', 'en');
        store.intents.draftText('title', 'en');
        await settled();

        const value = store.state.editor?.draft.value;
        expect([value?.label, value?.description]).toEqual([
            { ro: 'Corona [ro]', en: 'Corona' },
            { ro: 'Fotografie.', en: 'Fotografie. [en]' },
        ]);
        expect(world.callables.named('assist.translateDraft')).toBe(2);
        expect(store.state.assist.drafts['label.ro']).toMatchObject({ status: 'done', model: 'gemini-3.5-flash-lite' });
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_noLayerOpenOrATitleAsksNothingAndAnotherLayerForgetsTheDrafts', async () => {
        const { world, store } = open([]);

        store.intents.draftText('label', 'en');
        store.intents.suggestTitle();
        store.intents.useTitle(0);
        await settled();
        expect(world.callables.calls).toEqual([]);

        store.open(['plan']);
        store.intents.draftText('label', 'en');
        await settled();
        expect(store.state.assist.drafts['label.en']?.status).toBe('done');
        store.open(['corona']);

        expect(store.state.assist.drafts).toEqual({});
    });
});
