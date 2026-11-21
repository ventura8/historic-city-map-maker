import { describe, expect, it } from 'vitest';

import { reportModal, watchModals } from '../../src/components/modal-registry.js';

describe('the open modal dialogs of a document', () => {
    it('happyPath_aWatcherHearsTheFirstOpenAndTheLastCloseOnly', () => {
        const doc = document.implementation.createHTMLDocument('modals');
        const heard: boolean[] = [];
        const first = {};
        const second = {};

        const stop = watchModals(doc, (open) => heard.push(open));
        reportModal(doc, first, true);
        reportModal(doc, second, true);
        reportModal(doc, first, false);
        reportModal(doc, second, false);
        stop();
        reportModal(doc, first, true);

        expect(heard).toEqual([false, true, false]);
    });

    it('badPath_aWatcherStartsWithWhatIsOpenAndOtherDocumentsAreApart', () => {
        const doc = document.implementation.createHTMLDocument('open');
        const other = document.implementation.createHTMLDocument('other');
        const owner = {};
        reportModal(doc, owner, true);
        reportModal(doc, owner, true);
        const heard: boolean[] = [];
        const elsewhere: boolean[] = [];

        watchModals(doc, (open) => heard.push(open));
        watchModals(other, (open) => elsewhere.push(open));
        reportModal(other, {}, false);
        reportModal(doc, owner, false);

        expect([heard, elsewhere]).toEqual([[true, false], [false]]);
    });
});
