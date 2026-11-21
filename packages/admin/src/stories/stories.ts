/**
 * The stories area (M17, `docs/research/M17-stories.md` §6; behaviour A100): `#/stories` lists the city's stories (an
 * uploader's own only), `#/stories/<id>` opens one in an editor: its document live, its draft (`EditDraft`: Save writes the
 * changed fields guarded by the version read; a version saved meanwhile raises the conflict), Delete, and the city's photos and
 * places read once for the pickers. New story creates the document unpublished (pending for an uploader) and the page opens it.
 * DOM-free: the page renders the state and calls the intents.
 */
import {
    FIRESTORE_PATHS,
    isId,
    MAX_PHOTOS,
    MAX_POIS,
    photoDocSchema,
    poiDocSchema,
    storyDocSchema,
    validate,
    type StoryDoc,
} from '@hcm/shared';

import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc, LOADING_DOC } from '../content/doc.js';
import { LiveList, LOADING_LIST } from '../content/list.js';
import { readOnce } from '../content/read-once.js';
import { ownerOnlyOf, type ContentServices, type WriteOutcome } from '../content/services.js';
import { EditDraft, EMPTY_DRAFT } from '../layers/draft.js';
import { Store } from '../state/store.js';
import {
    newStory,
    pickOf,
    STORY_EDITABLE,
    storiesQuery,
    storyIssues,
    storyItemOf,
    type StoriesIntents,
    type StoriesState,
    type StoryItem,
    type StoryPick,
} from './model.js';

type DoneKey =
    'adminContent.stories.created' | 'adminContent.stories.createdPending' | 'adminContent.stories.deleted' | 'adminContent.stories.saved';

const INITIAL: StoriesState = { list: LOADING_LIST, open: null, picks: null, reviewer: false, role: null, busy: false };

class StoriesStore implements AreaStore<StoriesState, StoriesIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<StoriesState>;
    readonly #list: LiveList<StoryDoc, StoryItem>;
    readonly #doc: LiveDoc<StoryDoc>;
    #draft: EditDraft<StoryDoc> | null = null;
    /** The pickers' read was asked for (once per store). */
    #picking = false;
    readonly intents: StoriesIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<StoriesState>(INITIAL, services.log);
        const { store, clock } = services;
        const denied = (): void => {
            services.denied();
        };
        this.#list = new LiveList({
            ...{ store, clock, denied, schema: storyDocSchema, map: storyItemOf },
            collection: FIRESTORE_PATHS.stories(services.cityId),
            changed: (list) => {
                this.#cell.update({ list });
            },
        });
        this.#doc = new LiveDoc({
            ...{ store, clock, denied, schema: storyDocSchema },
            changed: (doc) => {
                this.#draft?.load(doc.doc);
                this.#patchOpen({ doc });
            },
        });
        this.intents = this.#intents();
    }

    get state(): StoriesState {
        return this.#cell.state;
    }

    subscribe(listener: (state: StoriesState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        if (!this.#list.active) {
            this.#list.show(storiesQuery(ownerOnlyOf(this.#services)));
        }
        const role = this.#services.cityRole();
        this.#cell.update({ reviewer: role !== 'uploader', role });
        this.#select(params[0] ?? null);
    }

    close(): void {
        this.#list.stop();
        this.#select(null);
    }

    hasUnsavedChanges(): boolean {
        return this.#draft?.unsaved === true;
    }

    destroy(): void {
        this.close();
    }

    #select(id: string | null): void {
        if (id !== (this.#cell.state.open?.id ?? null)) {
            this.#doc.stop();
            this.#draft = this.#draftOf(id);
            this.#cell.update({ open: id === null ? null : { id, doc: LOADING_DOC, draft: EMPTY_DRAFT } });
            this.#watch();
        }
    }

    #watch(): void {
        if (this.#draft !== null) {
            this.#doc.show(this.#draft.path);
        }
    }

    /** A draft of a well-formed id; an id no path can have opens nothing. */
    #draftOf(id: string | null): EditDraft<StoryDoc> | null {
        return id !== null && isId(id) ? this.#newDraft(id) : null;
    }

    #newDraft(id: string): EditDraft<StoryDoc> {
        const spec = {
            path: FIRESTORE_PATHS.story(this.#services.cityId, id),
            schema: storyDocSchema,
            editable: STORY_EDITABLE,
            check: storyIssues,
        };
        return new EditDraft<StoryDoc>(spec, {
            store: this.#services.store,
            locked: () => this.#services.readOnly(),
            changed: (draft) => {
                if (draft.conflict !== null) {
                    this.#services.people();
                }
                this.#patchOpen({ draft });
            },
        });
    }

    #patchOpen(patch: Partial<NonNullable<StoriesState['open']>>): void {
        const open = this.#cell.state.open;
        if (open !== null) {
            this.#cell.update({ open: { ...open, ...patch } });
        }
    }

    async #create(title: string): Promise<string | null> {
        const fields = newStory(title, this.#services.cityRole() === 'uploader');
        if (!validate(storyDocSchema, { ...fields, updatedBy: 'draft', updatedAt: { seconds: 0, nanoseconds: 0 } }).ok) {
            return null;
        }
        const id = this.#services.store.newId();
        const outcome = await this.#busy(() =>
            this.#services.store.create(FIRESTORE_PATHS.story(this.#services.cityId, id), fields, { withCreator: true }),
        );
        this.#told(outcome, 'reviewStatus' in fields ? 'adminContent.stories.createdPending' : 'adminContent.stories.created');
        return outcome.ok ? id : null;
    }

    async #remove(): Promise<WriteOutcome | null> {
        const draft = this.#removable();
        return draft === null ? null : this.#removed(draft.path, draft.state.base?.version ?? '');
    }

    /** The open story's draft once its document was read, while nothing else is being written. */
    #removable(): EditDraft<StoryDoc> | null {
        const draft = this.#draft;
        return draft?.state.base === null || draft === null || this.#cell.state.busy ? null : draft;
    }

    async #removed(path: string, version: string): Promise<WriteOutcome> {
        const outcome = await this.#busy(() => this.#services.store.remove(path, version));
        this.#told(outcome, 'adminContent.stories.deleted');
        return outcome;
    }

    async #save(): Promise<WriteOutcome | null> {
        const outcome = (await this.#draft?.save()) ?? null;
        if (outcome !== null) {
            this.#told(outcome, 'adminContent.stories.saved');
        }
        return outcome;
    }

    async #busy(write: () => Promise<WriteOutcome>): Promise<WriteOutcome> {
        this.#cell.update({ busy: true });
        try {
            return await write();
        } finally {
            this.#cell.update({ busy: false });
        }
    }

    /** A write's outcome as the shell's notice: what was done, or why nothing was (a field's problem shows at the field). */
    #told(outcome: WriteOutcome, done: DoneKey): void {
        if (outcome.ok) {
            this.#services.notify({ key: done });
        } else if (outcome.reason !== 'invalid') {
            this.#services.notify({ key: outcome.reason === 'offline' ? 'adminContent.common.offline' : 'adminContent.common.denied' });
        }
    }

    async #loadPicks(): Promise<void> {
        if (this.#picking) {
            return;
        }
        this.#picking = true;
        const city = this.#services.cityId;
        const ownerOnly = ownerOnlyOf(this.#services);
        const query = ownerOnly === null ? {} : { where: [['createdBy', '==', ownerOnly]] as const };
        const [photos, places] = await Promise.all([
            readOnce(this.#services, FIRESTORE_PATHS.photos(city), photoDocSchema, { ...query, limit: MAX_PHOTOS }),
            readOnce(this.#services, FIRESTORE_PATHS.pois(city), poiDocSchema, { ...query, limit: MAX_POIS }),
        ]);
        const picks = (docs: Parameters<typeof pickOf>[0][] | undefined): readonly StoryPick[] => (docs ?? []).map(pickOf);
        this.#cell.update({ picks: { photos: picks(photos.page?.docs.slice()), places: picks(places.page?.docs.slice()) } });
    }

    #intents(): StoriesIntents {
        return {
            create: (title) => this.#create(title),
            edit: (patch) => {
                this.#draft?.edit(patch);
            },
            save: () => this.#save(),
            discard: () => {
                this.#draft?.discard();
            },
            keepMine: () => {
                this.#draft?.keepMine();
            },
            takeTheirs: () => {
                this.#draft?.takeTheirs();
            },
            remove: () => this.#remove(),
            more: () => {
                this.#list.more();
            },
            retry: () => {
                this.#list.retry();
                this.#doc.retry();
            },
            loadPicks: () => {
                void this.#loadPicks();
            },
        };
    }
}

export const STORIES_MODULE: AreaModule<StoriesState, StoriesIntents> = {
    area: 'stories',
    create: (services) => new StoriesStore(services),
};
