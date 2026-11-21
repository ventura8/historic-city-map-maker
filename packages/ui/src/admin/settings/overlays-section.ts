/**
 * The overlays section (`docs/research/M2c-interfaces.md` §8.5; behaviour A36): the kit's `hcm-overlay-list`, the one
 * the visitors' Layers panel shows, over every overlay with the opacity the viewer opens with, and Shown at start for a
 * historical layer only (the other rows have no switch, CR-M2c-10). Each change previews live on the page's map; one
 * Save writes every changed document; a visitor's own `op=` still wins in the viewer.
 */
import { translate, type OverlayKind } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { OverlayListItem } from '../../components/overlay-list.js';
import { saveBar } from '../layers/form-parts.js';
import { contentText } from '../shell/text.js';
import { SETTINGS_SAVE_TEXTS, sectionTitle, type SectionContext } from './section-parts.js';

interface OpacityDetail {
    readonly id: string;
    readonly opacity: number;
    readonly final: boolean;
}

export function overlaysSection(context: SectionContext): TemplateResult {
    const { locale, intents, view } = context;
    const rows = view.overlays.rows;
    const items: OverlayListItem[] = rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        label: locale === 'en' ? (row.label.en ?? row.label.ro) : row.label.ro,
        visible: row.visible,
        opacity: row.opacity,
        toggleable: row.toggleable,
        ...(row.color === undefined ? {} : { color: row.color }),
        ...(row.icon === undefined ? {} : { icon: row.icon }),
    }));
    const kinds = new Map<string, OverlayKind>(rows.map((row) => [row.id, row.kind]));
    const opacity = (event: Event): void => {
        const detail = (event as CustomEvent<OpacityDetail>).detail;
        intents?.setOverlayOpacity(kinds.get(detail.id) ?? 'raster', detail.id, Math.round(detail.opacity * 100));
    };
    const visibility = (event: Event): void => {
        const detail = (event as CustomEvent<{ readonly id: string; readonly visible: boolean }>).detail;
        intents?.setShownAtStart(detail.id, detail.visible);
    };
    const changes = view.overlays.changes;
    return html`<h2 tabindex="-1" data-detail-heading>${sectionTitle(locale, 'overlays')}</h2>
        ${saveBar(
            locale,
            SETTINGS_SAVE_TEXTS,
            { dirty: changes > 0, saving: view.overlays.saving, blocked: false, readOnly: context.readOnly },
            {
                save: () => {
                    void intents?.saveOverlays();
                },
                discard: () => {
                    intents?.discardOverlays();
                },
            },
        )}
        <p class="note">${contentText(locale, 'adminContent.settings.overlaysIntro')}</p>
        <hcm-overlay-list
            ?disabled=${context.readOnly}
            .items=${items}
            .groups=${[
                { kind: 'raster', label: translate(locale, 'layers.group.historical') },
                { kind: 'poi', label: translate(locale, 'layers.group.places') },
            ]}
            toggle-label=${contentText(locale, 'adminContent.settings.overlayShow', { name: '{name}' })}
            opacity-label=${contentText(locale, 'adminContent.settings.overlayOpacity', { name: '{name}' })}
            value-text=${contentText(locale, 'adminContent.layers.percent', { percent: '{percent}' })}
            changed-text=${contentText(locale, 'adminContent.settings.overlayChanged', { name: '{name}', percent: '{percent}' })}
            shown-text=${contentText(locale, 'adminContent.settings.overlayShown', { name: '{name}' })}
            hidden-text=${contentText(locale, 'adminContent.settings.overlayHidden', { name: '{name}' })}
            @hcm-overlay-opacity=${opacity}
            @hcm-overlay-visibility=${visibility}
        ></hcm-overlay-list>`;
}
