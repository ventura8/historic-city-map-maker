/**
 * What `<hcm-stories-page>` reads of the stories area's store (M17, `docs/research/M17-stories.md` §6), mirrored structurally
 * from `packages/admin/src/stories/model.ts` as every area's port is (`../content-port.ts`).
 */
import type { CityRole, StoryDoc } from '@hcm/shared';

import type { DocStatePort, ListStatePort } from '../area-port.js';
import type { DraftStatePort, WriteOutcomePort } from '../layers/layers-port.js';

interface TextPort {
    readonly ro: string;
    readonly en?: string | undefined;
}

export interface StoryItemPort {
    readonly id: string;
    readonly title: TextPort;
    readonly yearStart: number | null;
    readonly yearEnd: number | null;
    readonly published: boolean;
    readonly review: 'pending' | 'refused' | null;
}

export interface StoryPickPort {
    readonly id: string;
    readonly title: TextPort;
}

export interface StoriesViewState {
    readonly list: ListStatePort<StoryItemPort>;
    readonly open: {
        readonly id: string;
        readonly doc: DocStatePort<StoryDoc>;
        readonly draft: DraftStatePort<StoryDoc>;
    } | null;
    readonly picks: { readonly photos: readonly StoryPickPort[]; readonly places: readonly StoryPickPort[] } | null;
    readonly reviewer: boolean;
    /** The city role (null: staff without one); New story, Delete and Versions follow it as the rules do. */
    readonly role: CityRole | null;
    readonly busy: boolean;
}

export interface StoriesIntentsPort {
    create(title: string): Promise<string | null>;
    edit(patch: Partial<StoryDoc>): void;
    save(): Promise<WriteOutcomePort | null>;
    discard(): void;
    keepMine(): void;
    takeTheirs(): void;
    remove(): Promise<WriteOutcomePort | null>;
    more(): void;
    retry(): void;
    loadPicks(): void;
}
