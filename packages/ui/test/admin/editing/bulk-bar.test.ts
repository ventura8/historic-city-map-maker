// `bulkBar` (packages/ui/src/admin/editing/bulk-bar.ts): renders the selection bar's two rows, wires Clear, Select all,
// primary/tonal buttons and the overflow menu, and disables every action while `off` is true.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { bulkBar, bulkBarStyles, type BulkBarInput } from '../../../src/admin/editing/bulk-bar.js';
import { defineEditingElements } from '../../../src/admin/editing/define.js';
import type { HcmOverflowMenu } from '../../../src/admin/editing/hcm-overflow-menu.js';
import { cleanup, fixture, part } from '../../helpers.js';

function makeInput(overrides: Partial<BulkBarInput> = {}): BulkBarInput {
    return {
        label: 'Selection actions',
        count: 'Selected: 2',
        selectAll: 'Select all',
        clear: 'Clear',
        buttons: [
            { id: 'publish', label: 'Publish', icon: 'publish' },
            { id: 'archive', label: 'Archive', icon: 'archive' },
        ],
        more: [
            { id: 'export', label: 'Export', icon: 'download' },
            { id: 'delete', label: 'Delete', icon: 'delete', disabled: true },
        ],
        moreLabel: 'More actions',
        closeLabel: 'Close',
        off: false,
        onSelectAll: () => undefined,
        onClear: () => undefined,
        onAction: () => undefined,
        ...overrides,
    };
}

describe('bulkBar', () => {
    beforeAll(() => {
        defineEditingElements();
    });
    afterEach(cleanup);

    it('happyPath_rendersButtonsAndOverflowAndForwardsEveryAction', async () => {
        const events: string[] = [];
        const section = await fixture<HTMLElement>(
            bulkBar(
                makeInput({
                    onClear: () => events.push('clear'),
                    onSelectAll: () => events.push('select-all'),
                    onAction: (id) => events.push(`action:${id}`),
                }),
            ),
        );

        expect(section.getAttribute('aria-label')).toBe('Selection actions');
        expect(part(section, '.count').textContent).toBe('Selected: 2');
        expect(part(section, '.publish').getAttribute('variant')).toBe('filled');
        expect(part(section, '.archive').getAttribute('variant')).toBe('tonal');

        part(section, '.clear').click();
        part(section, '.select-all').click();
        part(section, '.publish').click();
        part(section, '.archive').click();
        const menu = part(section, '.bulk-more') as HcmOverflowMenu;
        menu.dispatchEvent(new CustomEvent('hcm-action', { detail: { id: 'export' }, bubbles: true, composed: true }));

        expect(menu.actions.map((action) => action.disabled)).toEqual([false, true]);
        expect(events).toEqual(['clear', 'select-all', 'action:publish', 'action:archive', 'action:export']);
        expect(bulkBarStyles.cssText).toContain('.bulk-bar');
    });

    it('badPath_disablesEveryActionWhileOffIsTrue', async () => {
        const section = await fixture<HTMLElement>(bulkBar(makeInput({ off: true })));
        const menu = part(section, '.bulk-more') as HcmOverflowMenu;

        expect(part(section, '.publish').hasAttribute('disabled')).toBe(true);
        expect(part(section, '.archive').hasAttribute('disabled')).toBe(true);
        expect(menu.actions.every((action) => action.disabled === true)).toBe(true);
    });
});
