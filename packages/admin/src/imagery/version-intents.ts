/**
 * The version page's decisions as Imagery intents (`imagery.ts`): each one is the open version's own action
 * (`version.ts`), from approval to Redraw at full resolution (2026-11-23).
 */
import type { PublishChoice } from '@hcm/shared';

import type { ImageryIntents } from './state.js';
import type { VersionPage } from './version.js';

export type VersionPageIntents = Pick<
    ImageryIntents,
    | 'approve'
    | 'recalibrate'
    | 'toggleCurrent'
    | 'reject'
    | 'confirmRights'
    | 'deleteVersion'
    | 'makeLive'
    | 'choose'
    | 'studioDone'
    | 'download'
    | 'retryJob'
    | 'locateAgain'
    | 'fixTiles'
    | 'redraw'
    | 'cancelJob'
>;

/** The open version's actions, each bound to it. */
export function versionPageIntents(version: VersionPage): VersionPageIntents {
    return {
        approve: (acceptWorse?: boolean) => version.approve(acceptWorse),
        recalibrate: () => version.recalibrate(),
        toggleCurrent: version.toggleCurrent.bind(version),
        reject: () => version.reject(),
        confirmRights: (confirmedBy: string) => version.confirmRights(confirmedBy),
        choose: (choice: PublishChoice) => version.choose(choice),
        deleteVersion: () => version.deleteVersion(),
        makeLive: () => version.makeLive(),
        redraw: () => version.redraw(),
        studioDone: () => version.studioDone(),
        download: () => version.download(),
        retryJob: () => version.retry(),
        locateAgain: () => version.locateAgain(),
        fixTiles: () => version.fixTiles(),
        cancelJob: () => version.cancel(),
    };
}
