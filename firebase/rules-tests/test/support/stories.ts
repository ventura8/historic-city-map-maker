/** M17's documents for the rules tests (docs/research/M17-stories.md §1): a staff's story, a new one, and the editor's update. */
import { past, serverTime, stampedBy, type Data } from './world.js';

/** A story's text fields, its figure and its links. */
function storyText(): Data {
    return {
        title: { ro: 'Teatrul Național', en: 'The National Theatre' },
        body: { ro: 'Bombardat în **1944**.\n\n![Fațada](photo:p1)', en: 'Bombed in **1944**.' },
        yearStart: 1852,
        yearEnd: 1944,
        photoIds: ['p1'],
        poiIds: ['poi1'],
    };
}

/** A published story of staff, approved. */
export function storyDoc(creator: string): Data {
    return {
        ...storyText(),
        published: true,
        reviewStatus: 'approved',
        reviewNote: 'Bună.',
        reviewedBy: creator,
        reviewedAt: past(),
        credit: 'Ion Mureșan',
        createdAt: past(),
        createdBy: creator,
        updatedBy: creator,
        updatedAt: past(),
    };
}

/** A staff's new story, exactly `CLIENT_WRITES.story.create`. */
export function newStory(uid: string): Data {
    return { ...storyText(), published: false, credit: 'Ion Mureșan', createdAt: serverTime(), createdBy: uid, ...stampedBy(uid) };
}

/** Every field of `CLIENT_WRITES.story.update` at its limit (`EDITS.story`). */
export const STORY_EDITS: Readonly<Data> = {
    title: { ro: 'Hanul cu Tei' },
    body: { ro: 'x'.repeat(10_000), en: 'A [source](https://example.org).' },
    yearStart: 1800,
    yearEnd: 2100,
    photoIds: Array.from({ length: 20 }, (_, index) => `p${String(index)}`),
    poiIds: Array.from({ length: 20 }, (_, index) => `poi${String(index)}`),
    credit: 'Maria Popescu',
    published: false,
};
