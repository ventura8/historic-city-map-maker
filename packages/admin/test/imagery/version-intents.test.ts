/**
 * The version page's decisions as Imagery intents (`packages/admin/src/imagery/version-intents.ts`): each one calls the open
 * version's own action, Redraw at full resolution among them.
 */
import { describe, expect, it } from 'vitest';

import { versionPageIntents } from '../../src/imagery/version-intents.js';
import type { VersionPage } from '../../src/imagery/version.js';

const ACTIONS = [
    'approve',
    'recalibrate',
    'toggleCurrent',
    'reject',
    'confirmRights',
    'choose',
    'deleteVersion',
    'makeLive',
    'redraw',
    'studioDone',
    'download',
    'retry',
    'locateAgain',
    'fixTiles',
    'cancel',
] as const;

function fakeVersion(called: string[]): VersionPage {
    const page: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ACTIONS) {
        page[name] = (...args: unknown[]) => {
            called.push([name, ...args.map(String)].join(' '));
            return Promise.resolve(true);
        };
    }
    return page as unknown as VersionPage;
}

describe('the version page intents', () => {
    it('happyPath_eachIntentCallsTheOpenVersionsAction @S-A16-HAPPY-REDRAW', async () => {
        const called: string[] = [];
        const intents = versionPageIntents(fakeVersion(called));

        await intents.approve(true);
        await intents.recalibrate();
        intents.toggleCurrent();
        await intents.reject();
        await intents.confirmRights('the owner');
        await intents.choose('studio');
        await intents.deleteVersion();
        await intents.makeLive();
        await intents.redraw();
        await intents.studioDone();
        await intents.download();
        await intents.retryJob();
        await intents.locateAgain();
        await intents.fixTiles();
        await intents.cancelJob();

        expect(called).toEqual([
            'approve true',
            'recalibrate',
            'toggleCurrent',
            'reject',
            'confirmRights the owner',
            'choose studio',
            'deleteVersion',
            'makeLive',
            'redraw',
            'studioDone',
            'download',
            'retry',
            'locateAgain',
            'fixTiles',
            'cancel',
        ]);
    });
});
