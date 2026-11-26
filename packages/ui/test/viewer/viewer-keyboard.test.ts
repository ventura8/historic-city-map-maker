import { afterEach, describe, expect, it } from 'vitest';

import { SHORTCUT_ROWS, isViewerKey, shortcutOf } from '../../src/viewer/viewer-keyboard.js';

function key(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init });
}

/** Dispatches `event` from `target` and answers `isViewerKey` for `viewer` while it travels. */
function ask(viewer: Element, target: EventTarget, event: KeyboardEvent): boolean {
    const answers: boolean[] = [];
    const listener = (seen: Event): void => {
        answers.push(isViewerKey(viewer, seen as KeyboardEvent));
    };
    document.addEventListener('keydown', listener);
    target.dispatchEvent(event);
    document.removeEventListener('keydown', listener);
    return answers[0] === true;
}

function viewerWithShadow(): { readonly viewer: HTMLElement; readonly shadow: ShadowRoot } {
    const viewer = document.createElement('hcm-test-viewer');
    const shadow = viewer.attachShadow({ mode: 'open' });
    document.body.append(viewer);
    return { viewer, shadow };
}

describe('shortcutOf', () => {
    it('happyPath_everyKeyHasOneCommand', () => {
        const keys = SHORTCUT_ROWS.flatMap(([row]) => row);
        const commands = keys.map((pressed) => shortcutOf(key(pressed)));

        expect(commands).toEqual([
            'year-next',
            'year-previous',
            'opacity-up',
            'opacity-down',
            'photo-next',
            'photo-previous',
            'layers',
            'help',
        ]);
    });

    it('badPath_keysOfMapboxAndTheTimelineAreNotTaken', () => {
        for (const other of ['ArrowLeft', 'ArrowUp', '+', '-', '=', 'Enter', ' ', 'Escape', 'Tab']) {
            expect(shortcutOf(key(other))).toBeNull();
        }
    });

    it('badPath_aModifiedKeyIsTheBrowsersOrALayouts', () => {
        expect(shortcutOf(key('l', { ctrlKey: true }))).toBeNull();
        expect(shortcutOf(key('l', { metaKey: true }))).toBeNull();
        expect(shortcutOf(key('l', { altKey: true }))).toBeNull();
        expect(shortcutOf(key('l', { isComposing: true }))).toBeNull();
    });

    it('badPath_aKeyAlreadyHandledIsLeft', () => {
        const event = key('l');
        event.preventDefault();
        expect(shortcutOf(event)).toBeNull();
    });

    it('edge_onlyOpacityRepeatsWhenHeld', () => {
        expect(shortcutOf(key('o', { repeat: true }))).toBe('opacity-up');
        expect(shortcutOf(key('n', { repeat: true }))).toBeNull();
    });
});

describe('isViewerKey', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_fromInsideTheViewer', () => {
        const { viewer, shadow } = viewerWithShadow();
        const button = document.createElement('button');
        shadow.append(button);

        expect(ask(viewer, button, key('l'))).toBe(true);
    });

    it('badPath_typingInsideTheViewerIsLeftAlone', () => {
        const { viewer, shadow } = viewerWithShadow();
        for (const markup of ['input', 'textarea', 'select']) {
            const field = document.createElement(markup);
            shadow.append(field);
            expect(ask(viewer, field, key('l'))).toBe(false);
        }
        const editable = document.createElement('div');
        editable.contentEditable = 'true';
        shadow.append(editable);
        expect(ask(viewer, editable, key('l'))).toBe(false);
        const menuItem = document.createElement('button');
        menuItem.setAttribute('role', 'menuitem');
        shadow.append(menuItem);
        expect(ask(viewer, menuItem, key('l'))).toBe(false);
    });

    it('happyPath_fromTheBodyForThePagesFirstViewer', () => {
        const { viewer } = viewerWithShadow();
        const second = viewerWithShadow().viewer;

        expect(ask(viewer, document.body, key('l'))).toBe(true);
        expect(ask(second, document.body, key('l'))).toBe(false);
    });

    it('badPath_theHostPagesOwnControlsAreLeftAlone', () => {
        const { viewer } = viewerWithShadow();
        const field = document.createElement('input');
        document.body.append(field);

        expect(ask(viewer, field, key('l'))).toBe(false);
    });
});
