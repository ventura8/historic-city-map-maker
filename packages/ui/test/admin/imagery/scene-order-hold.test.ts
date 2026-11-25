import { render } from 'lit';
import { describe, expect, it } from 'vitest';

import { SceneOrderHold } from '../../../src/admin/imagery/scene-order-hold.js';

function scenes(...ids: string[]): { readonly id: string }[] {
    return ids.map((id) => ({ id }));
}

function ids(list: readonly { readonly id: string }[]): string[] {
    return list.map((scene) => scene.id);
}

function noteText(hold: SceneOrderHold): string {
    const host = document.createElement('div');
    render(hold.note('en'), host);
    return host.querySelector('[role="status"]')?.textContent ?? '';
}

function focusOut(hold: SceneOrderHold, list: HTMLElement, to: EventTarget | null): void {
    list.addEventListener('focusout', hold.onFocusOut, { once: true });
    list.dispatchEvent(new FocusEvent('focusout', { relatedTarget: to }));
}

describe('the scene list keeps its order while it is in use (§251)', () => {
    it('happyPath_aHeldListKeepsItsRowsWhereTheyWereAndTakesTheNewOrderWithANoteOnceLeft @S-A234-HAPPY-ORDER-HELD', () => {
        let updates = 0;
        const hold = new SceneOrderHold(() => {
            updates += 1;
        });
        expect(ids(hold.order(scenes('a', 'b', 'c')))).toEqual(['a', 'b', 'c']);

        hold.onPointerEnter();
        // A measured preview moves c to the top, d arrives and b goes: the rows stay, d joins at the end.
        expect(ids(hold.order(scenes('c', 'a', 'd')))).toEqual(['a', 'c', 'd']);
        expect(noteText(hold)).toBe('');
        expect(updates).toBe(0);

        hold.onPointerLeave();
        expect(updates).toBe(1);
        expect(ids(hold.order(scenes('c', 'a', 'd')))).toEqual(['c', 'a', 'd']);
        expect(noteText(hold)).toBe('The list is now in its new order: the ranking changed while you were using it.');

        // The next use of the list: the note has been read.
        hold.onPointerEnter();
        expect(updates).toBe(2);
        expect(noteText(hold)).toBe('');
    });

    it('happyPath_theFocusHoldsTheOrderUntilItLeavesTheListAndTheRankingThatCameBackSaysNothing', () => {
        let updates = 0;
        const hold = new SceneOrderHold(() => {
            updates += 1;
        });
        hold.order(scenes('a', 'b'));
        const list = document.createElement('ul');
        const row = document.createElement('li');
        list.append(row);

        hold.onFocusIn();
        expect(ids(hold.order(scenes('b', 'a')))).toEqual(['a', 'b']);
        // Tab from one row to the next stays in the list.
        focusOut(hold, list, row);
        expect(ids(hold.order(scenes('b', 'a')))).toEqual(['a', 'b']);
        // The ranking came back to the order shown: leaving shows it, with no note.
        expect(ids(hold.order(scenes('a', 'b')))).toEqual(['a', 'b']);
        focusOut(hold, list, document.body);
        expect(updates).toBe(1);
        expect(ids(hold.order(scenes('a', 'b')))).toEqual(['a', 'b']);
        expect(noteText(hold)).toBe('');
    });

    it('badPath_anUnusedListTakesEachNewRankingAtOnceAndAPointerLeavingWhileTheFocusStaysHolds @S-A234-BAD-ORDER-LIVE', () => {
        let updates = 0;
        const hold = new SceneOrderHold(() => {
            updates += 1;
        });
        hold.order(scenes('a', 'b'));
        expect(ids(hold.order(scenes('b', 'a')))).toEqual(['b', 'a']);
        expect(noteText(hold)).toBe('');

        hold.onFocusIn();
        hold.onPointerEnter();
        expect(ids(hold.order(scenes('a', 'b')))).toEqual(['b', 'a']);
        hold.onPointerLeave();
        expect(updates).toBe(0);
        expect(ids(hold.order(scenes('a', 'b')))).toEqual(['b', 'a']);
        // Nothing waits: a pointer leaving an unchanged list renders nothing again.
        const quiet = new SceneOrderHold(() => {
            updates += 10;
        });
        quiet.onPointerEnter();
        quiet.onPointerLeave();
        expect(updates).toBe(0);
    });
});
