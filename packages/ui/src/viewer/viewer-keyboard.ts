/**
 * The viewer's keyboard shortcuts (docs/research/viewer-input.md §2): which key means which command, and when a key is
 * the viewer's at all. Typing in a field, a key with Ctrl, Alt or Meta (AltGr reports both) and a key a control already
 * handled are never taken; arrows, `+`, `-` and `=` stay Mapbox's, the timeline's and the lightbox's.
 */
import type { MessageKey } from '@hcm/shared';

import type { InputCommand } from './input-commands.js';

const COMMANDS: Readonly<Record<string, InputCommand>> = {
    '.': 'year-next',
    ',': 'year-previous',
    o: 'opacity-up',
    i: 'opacity-down',
    n: 'photo-next',
    p: 'photo-previous',
    l: 'layers',
    '?': 'help',
};

/** The help panel's rows: the keys, in the order of their label's words. */
export const SHORTCUT_ROWS: readonly (readonly [readonly string[], MessageKey])[] = [
    [['.', ','], 'input.year'],
    [['o', 'i'], 'input.opacityKeys'],
    [['n', 'p'], 'input.photo'],
    [['l'], 'layers.title'],
    [['?'], 'input.help'],
];

const TYPING = 'input,textarea,select,[contenteditable],[role=textbox],[role=searchbox],[role=combobox],[role^=menuitem]';

function isModified(event: KeyboardEvent): boolean {
    return event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.defaultPrevented;
}

/** The command of a key press as such, wherever it came from; only the opacity keys repeat when held. */
export function shortcutOf(event: KeyboardEvent): InputCommand | null {
    const command = isModified(event) ? undefined : COMMANDS[event.key];
    return command === undefined || (event.repeat && !command.startsWith('opacity')) ? null : command;
}

/**
 * Whether a key press is `viewer`'s: from inside it, unless focus is in something that types; or from the page's body
 * while it is the page's first viewer. The host page's own controls and a second viewer are never driven.
 */
export function isViewerKey(viewer: Element, event: KeyboardEvent): boolean {
    const path = event.composedPath();
    const target = path[0];
    if (path.includes(viewer)) {
        return !(target instanceof Element && target.closest(TYPING) !== null);
    }
    const doc = viewer.ownerDocument;
    return target === doc.body && doc.querySelector(viewer.localName) === viewer;
}
