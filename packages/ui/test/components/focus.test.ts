import { afterEach, describe, expect, it } from 'vitest';

import { deepActiveElement, restoreFocus, tabbableElements, trapTab } from '../../src/components/focus.js';

function tab(shiftKey = false): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
}

/** <div> with: a button, a shadow host holding a link and a slot (with a slotted input), a disabled button, a span. */
function tree(): { root: HTMLElement; first: HTMLButtonElement; link: HTMLAnchorElement; input: HTMLInputElement } {
    const root = document.createElement('div');
    const first = root.appendChild(document.createElement('button'));
    first.textContent = 'first';
    const host = root.appendChild(document.createElement('div'));
    const shadow = host.attachShadow({ mode: 'open' });
    const link = shadow.appendChild(document.createElement('a'));
    link.href = '#x';
    link.textContent = 'link';
    shadow.appendChild(document.createElement('slot'));
    const input = host.appendChild(document.createElement('input'));
    const disabled = root.appendChild(document.createElement('button'));
    disabled.disabled = true;
    root.appendChild(document.createElement('span'));
    document.body.append(root);
    return { root, first, link, input };
}

describe('tabbableElements', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_walksShadowRootsAndSlotsInOrder', () => {
        const { root, first, link, input } = tree();

        expect(tabbableElements(root)).toEqual([first, link, input]);
    });

    it('badPath_skipsHiddenElementsAndHostsWithNegativeTabindex', () => {
        const { root, first } = tree();
        const host = root.children[1] as HTMLElement;
        host.tabIndex = -1;
        const hidden = root.appendChild(document.createElement('button'));
        hidden.hidden = true;

        expect(tabbableElements(root)).toEqual([first]);
    });
});

describe('deepActiveElement and trapTab', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_followsTheFocusIntoShadowRoots', () => {
        const { link } = tree();

        link.focus();

        expect(document.activeElement).not.toBe(link);
        expect(deepActiveElement()).toBe(link);
    });

    it('happyPath_tabFromTheLastWrapsToTheFirst', () => {
        const { root, first, input } = tree();
        input.focus();
        const event = tab();

        expect(trapTab(event, root)).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
    });

    it('happyPath_shiftTabFromTheFirstWrapsToTheLast', () => {
        const { root, first, input } = tree();
        first.focus();

        expect(trapTab(tab(true), root)).toBe(true);
        expect(document.activeElement).toBe(input);
    });

    it('happyPath_aShadowRootCanBeTheTrap', () => {
        const { root, link, input } = tree();
        const shadow = root.children[1]?.shadowRoot;
        if (shadow === null || shadow === undefined) {
            throw new Error('no shadow root');
        }
        link.focus();

        expect(trapTab(tab(), shadow)).toBe(false);
        expect(trapTab(tab(true), shadow)).toBe(true);
        expect(deepActiveElement()).toBe(input);
    });

    it('badPath_shiftTabOnTheFocusedContainerWrapsToTheLastInsteadOfLeaving', () => {
        // A modal sheet or the lightbox focuses its container on open: Shift+Tab from there used to leave the modal.
        const { root, input } = tree();
        root.tabIndex = -1;
        root.focus();

        expect(trapTab(tab(), root)).toBe(false);
        expect(trapTab(tab(true), root)).toBe(true);
        expect(document.activeElement).toBe(input);
    });

    it('badPath_shiftTabWithTheFocusOutsideIsLeftToTheBrowser', () => {
        const { root } = tree();
        (document.activeElement as HTMLElement | null)?.blur();

        expect(trapTab(tab(true), root)).toBe(false);
    });

    it('badPath_tabInTheMiddleIsLeftToTheBrowser', () => {
        const { root, link } = tree();
        link.focus();

        expect(trapTab(tab(), root)).toBe(false);
        expect(trapTab(tab(true), root)).toBe(false);
    });

    it('badPath_otherKeysAndEmptyContainersAreIgnored', () => {
        const { root } = tree();
        const empty = document.body.appendChild(document.createElement('div'));

        expect(trapTab(new KeyboardEvent('keydown', { key: 'Enter' }), root)).toBe(false);
        expect(trapTab(tab(), empty)).toBe(false);
    });
});

describe('restoreFocus', () => {
    it('happyPath_focusesAConnectedElement', () => {
        const button = document.body.appendChild(document.createElement('button'));

        restoreFocus(button);

        expect(document.activeElement).toBe(button);
        button.remove();
    });

    it('badPath_ignoresNullAndDetachedElements', () => {
        const detached = document.createElement('button');
        const before = document.activeElement;

        restoreFocus(null);
        restoreFocus(detached);

        expect(document.activeElement).toBe(before);
    });
});
