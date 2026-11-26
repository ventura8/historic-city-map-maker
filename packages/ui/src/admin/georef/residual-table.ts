/**
 * The georeferencer's residual table (`docs/research/M3-interfaces.md` §10.4): a native table of the pairs, each with
 * where it came from (under its name), whether the fit uses it (else it is a checkpoint), its scan pixel, its place and
 * its residual in metres; sortable by pair or by residual; a row's pair button selects the pair on both panes, its
 * checkbox keeps it as a checkpoint and Delete removes it. On a narrow table the pixel and place columns give way (the
 * panes show where each pair is), so nothing scrolls sideways (CR-M3-35 i). Text only: the pairs' ids and numbers are
 * never markup.
 */
import type { Gcp, UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { numberText } from '../imagery/imagery-text.js';
import { when } from '../imagery/when.js';
import { contentText } from '../shell/text.js';

export type ResidualSort = 'pair' | 'residual';

export interface ResidualTable {
    readonly locale: UiLocale;
    readonly pairs: readonly Gcp[];
    readonly residuals: Readonly<Record<string, number>>;
    readonly selected: string | null;
    readonly sort: ResidualSort;
    readonly readOnly: boolean;
    readonly onSort: (sort: ResidualSort) => void;
    /** A pair's button: selects it, or lets it go when it is the selected one (null). */
    readonly onSelect: (id: string | null) => void;
    readonly onToggle: (id: string) => void;
    readonly onRemove: (id: string) => void;
}

/** The pairs with their numbers, in the table's order (largest residual first when sorted by residual). */
function sorted(table: ResidualTable): readonly (readonly [Gcp, string])[] {
    const numbered = table.pairs.map((pair, index) => [pair, String(index + 1)] as const);
    if (table.sort === 'pair') {
        return numbered;
    }
    const residual = (pair: Gcp): number => table.residuals[pair.id] ?? -1;
    return numbered.toSorted(([a], [b]) => residual(b) - residual(a));
}

/** How the table is sorted by a column: pairs ascending, residuals largest first. */
const SORTED: Readonly<Record<ResidualSort, 'ascending' | 'descending'>> = { pair: 'ascending', residual: 'descending' };

function header(
    table: ResidualTable,
    sort: ResidualSort,
    key: 'adminContent.georef.column.pair' | 'adminContent.georef.column.residual',
): TemplateResult {
    const order = table.sort === sort ? SORTED[sort] : 'none';
    return html`<th scope="col" aria-sort=${order}>
        <button
            class="sort"
            type="button"
            @click=${() => {
                table.onSort(sort);
            }}
        >
            ${contentText(table.locale, key)}
        </button>
    </th>`;
}

function row(table: ResidualTable, pair: Gcp, label: string): TemplateResult {
    const { locale } = table;
    const residual = table.residuals[pair.id];
    const name = contentText(locale, 'adminContent.georef.pairName', { number: label });
    return html`<tr ?data-selected=${pair.id === table.selected} data-pair=${pair.id}>
        <th scope="row">
            <button
                class="pair"
                type="button"
                aria-pressed=${pair.id === table.selected ? 'true' : 'false'}
                @click=${() => {
                    table.onSelect(pair.id === table.selected ? null : pair.id);
                }}
            >
                ${name}
            </button>
            <span class="origin note">${contentText(locale, `adminContent.georef.origin.${pair.origin}`)}</span>
        </th>
        <td>
            <label class="use">
                <input
                    class="touch-target"
                    type="checkbox"
                    .checked=${pair.enabled}
                    ?disabled=${table.readOnly}
                    @change=${() => {
                        table.onToggle(pair.id);
                    }}
                />
                <span class="visually-hidden">${name} ${contentText(locale, 'adminContent.georef.use')}</span>
            </label>
        </td>
        <td class="position">${numberText(locale, pair.pixel.x, 1)}, ${numberText(locale, pair.pixel.y, 1)}</td>
        <td class="position">${numberText(locale, pair.geo.lat, 6)}, ${numberText(locale, pair.geo.lng, 6)}</td>
        <td data-residual>${residual === undefined ? '–' : `${numberText(locale, residual, 1)} m`}</td>
        <td>
            <hcm-icon-button
                icon="delete"
                label=${contentText(locale, 'adminContent.georef.remove', { name })}
                ?disabled=${table.readOnly}
                @click=${() => {
                    table.onRemove(pair.id);
                }}
            ></hcm-icon-button>
        </td>
    </tr>`;
}

export function residualTable(table: ResidualTable): TemplateResult {
    const { locale, pairs } = table;
    if (pairs.length === 0) {
        return html`<p class="note" data-state="no-pairs">${contentText(locale, 'adminContent.georef.noPairs')}</p>`;
    }
    const hint = when(!table.readOnly, () => html`<p class="note">${contentText(locale, 'adminContent.georef.tableHint')}</p>`);
    return html`<div class="table-box">
            <table class="residuals">
                <caption class="visually-hidden">
                    ${contentText(locale, 'adminContent.georef.tableCaption')}
                </caption>
                <thead>
                    <tr>
                        ${header(table, 'pair', 'adminContent.georef.column.pair')}
                        <th scope="col">${contentText(locale, 'adminContent.georef.column.use')}</th>
                        <th scope="col" class="position">${contentText(locale, 'adminContent.georef.column.pixel')}</th>
                        <th scope="col" class="position">${contentText(locale, 'adminContent.georef.column.place')}</th>
                        ${header(table, 'residual', 'adminContent.georef.column.residual')}
                        <th scope="col">
                            <span class="visually-hidden">${contentText(locale, 'adminContent.georef.column.actions')}</span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted(table).map(([pair, label]) => row(table, pair, label))}
                </tbody>
            </table>
        </div>
        ${hint}`;
}
