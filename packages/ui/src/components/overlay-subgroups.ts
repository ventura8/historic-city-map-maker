/**
 * A place category's sub-groups in `<hcm-overlay-list>` (the owner, 2026-11-22): a category with two or more (bridges,
 * lakes and ponds of the old rivers; or its points, lines and areas) gets a chevron button that shows one switch per
 * sub-group. A sub-group's switch fires `hcm-overlay-group` (`{id, group, visible}`); the category's own switch turns
 * them all on or off with it, and shows dimmed while only some are on. Which categories are open is remembered per viewer
 * (localStorage, every access guarded).
 */
import { css, html, type TemplateResult } from 'lit';

import { emit } from './internal.js';

/** One sub-group of a row. */
export interface OverlaySubgroup {
    readonly id: string;
    readonly label: string;
    readonly visible: boolean;
}

const OPEN_KEY = 'hcm.layerPanel.groupsOpen';

function readOpen(): Set<string> {
    try {
        const parsed: unknown = JSON.parse(globalThis.localStorage.getItem(OPEN_KEY) ?? '[]');
        return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
    } catch {
        return new Set();
    }
}

const open = readOpen();

function remember(): void {
    try {
        globalThis.localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
    } catch {
        // Storage blocked: the open rows are forgotten on the next load, nothing else changes.
    }
}

/** Whether the row `id` shows its sub-groups. */
export function subgroupsOpen(id: string): boolean {
    return open.has(id);
}

/** Opens or closes the row `id`'s sub-groups and asks `host` to render again. */
export function toggleSubgroups(host: HTMLElement & { requestUpdate(): void }, id: string): void {
    if (open.has(id)) {
        open.delete(id);
    } else {
        open.add(id);
    }
    remember();
    host.requestUpdate();
}

/** One sub-group's row: its name and switch. */
function subgroupRow(host: HTMLElement, id: string, group: OverlaySubgroup, toggleLabel: (name: string) => string): TemplateResult {
    const onChange = (event: Event): void => {
        const visible = (event as CustomEvent<{ readonly checked: boolean }>).detail.checked;
        emit(host, 'hcm-overlay-group', { id, group: group.id, visible });
    };
    return html`<li class="subgroup" data-group=${group.id}>
        <span class="body-medium">${group.label}</span>
        <hcm-switch .checked=${group.visible} label=${toggleLabel(group.label)} @hcm-change=${onChange}></hcm-switch>
    </li>`;
}

/** The chevron and, while open, the sub-group switches of a row with two or more sub-groups; an empty template otherwise. */
export function renderSubgroups(
    host: HTMLElement & { requestUpdate(): void },
    item: { readonly id: string; readonly subgroups?: readonly OverlaySubgroup[]; readonly expandLabel?: string },
    toggleLabel: (name: string) => string,
): TemplateResult {
    const groups = item.subgroups ?? [];
    if (groups.length < 2) {
        return html``;
    }
    const expanded = subgroupsOpen(item.id);
    const name = item.expandLabel ?? item.id;
    const onToggle = (): void => {
        toggleSubgroups(host, item.id);
    };
    return html`<button
            type="button"
            class="subgroups-toggle"
            aria-expanded=${String(expanded)}
            aria-controls=${`groups-${item.id}`}
            aria-label=${name}
            title=${name}
            @click=${onToggle}
        >
            <hcm-icon name=${expanded ? 'expand_less' : 'expand_more'}></hcm-icon>
        </button>
        <ul class="subgroups" id=${`groups-${item.id}`} role="list" ?hidden=${!expanded}>
            ${groups.map((group) => subgroupRow(host, item.id, group, toggleLabel))}
        </ul>`;
}

export const subgroupStyles = css`
    .subgroups-toggle {
        display: inline-grid;
        place-items: center;
        inline-size: 48px;
        block-size: 48px;
        padding: 0;
        border: 0;
        border-radius: var(--md-sys-shape-corner-full);
        background: transparent;
        color: var(--md-sys-color-on-surface-variant);
        cursor: pointer;
    }

    .subgroups {
        grid-column: 1 / -1;
        margin: 0;
        padding-inline-start: 40px;
        list-style: none;
    }

    .subgroups[hidden] {
        display: none;
    }

    .subgroup {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-block-size: 48px;
    }

    hcm-switch[data-mixed] {
        opacity: 0.6;
    }
`;
