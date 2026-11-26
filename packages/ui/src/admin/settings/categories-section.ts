/**
 * The categories section (`docs/research/M2c-interfaces.md` §8.5, §9.5; behaviours A33, A39): the POI categories in the
 * viewer's order, reordered by a drag or Move up and Move down, **Add a category** (off at `MAX_POI_CATEGORIES`, the
 * limit named), **Add the starter categories** the city lacks (off, with the reason, when every one is there), and the
 * open category's editor: names, icon, colour (the nearest readable tone proposed when the white glyph does not read on
 * it), default opacity (previewed live), Save, and Delete, which asks where a category's places go when it is in use.
 */
import { MAX_POI_CATEGORIES, POI_ICONS, type UiLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { cssProperties } from '../../components/css-properties.js';
import { listBody } from '../editing/states.js';
import { conflictBanner, field, issueAt, saveBar, saveStateOf, sliderRow } from '../layers/form-parts.js';
import { reorderList, type RowDrag } from '../layers/reorder.js';
import { categoryDisplay } from './category-display.js';
import { contentText } from '../shell/text.js';
import { SETTINGS_CONFLICT_TEXTS, SETTINGS_SAVE_TEXTS, sectionTitle, type SectionContext } from './section-parts.js';
import type { CategoryDeletionPort, CategoryEditorPort, CategoryItemPort, CategoryValuePort } from './settings-port.js';
import { startersButton, startersReason } from './starter-actions.js';

/** The route of a category not saved yet. */
const NEW_CATEGORY = '_new';

function labelText(label: { readonly ro: string; readonly en?: string | undefined }, locale: UiLocale): string {
    return locale === 'en' ? (label.en ?? label.ro) : label.ro;
}

/** A category's icon on its colour, drawn white as the map draws it. */
function swatch(color: string, icon: string): TemplateResult {
    return html`<span class="swatch" aria-hidden="true" ${cssProperties({ '--swatch': color, '--swatch-glyph': '#ffffff' })}
        ><hcm-icon name=${(POI_ICONS as readonly string[]).includes(icon) ? icon : 'location_on'}></hcm-icon
    ></span>`;
}

/** Add a category and Add the starter categories, off at `MAX_POI_CATEGORIES` (the limit named instead). */
function addActions(context: SectionContext): TemplateResult {
    const { locale, view } = context;
    if (!view.canAddCategory) {
        return html`<div class="actions">
            <p class="note">${contentText(locale, 'adminContent.settings.categoryLimit', { max: String(MAX_POI_CATEGORIES) })}</p>
        </div>`;
    }
    const present = view.startersMissing === 0;
    return html`<div class="actions">
            <hcm-button
                variant="tonal"
                icon="add"
                ?disabled=${context.readOnly}
                @click=${() => {
                    context.go(['categories', NEW_CATEGORY]);
                }}
                >${contentText(locale, 'adminContent.settings.addCategory')}</hcm-button
            >
            ${startersButton(context, present)}
        </div>
        ${startersReason(context, present)}`;
}

function categoryList(context: SectionContext, drag: RowDrag): TemplateResult {
    const { locale, view, intents } = context;
    const rows = (items: readonly CategoryItemPort[]): TemplateResult =>
        reorderList(
            items.map((category) => ({
                id: category.id,
                title: labelText(category.label, locale),
                detail: contentText(locale, 'adminContent.layers.percent', { percent: String(Math.round(category.defaultOpacity * 100)) }),
                href: context.href(['categories', category.id]),
                selected: false,
                lead: swatch(category.color, category.icon),
            })),
            {
                up: (name) => contentText(locale, 'adminContent.settings.categoryUp', { name }),
                down: (name) => contentText(locale, 'adminContent.settings.categoryDown', { name }),
                list: sectionTitle(locale, 'categories'),
            },
            {
                move: (id, direction) => {
                    void intents?.moveCategory(id, direction);
                },
                readOnly: context.readOnly,
            },
            drag,
        );
    return html`<h2 tabindex="-1" data-detail-heading>${sectionTitle(locale, 'categories')}</h2>
        ${addActions(context)}
        ${listBody(
            locale,
            view.categories,
            { empty: 'adminContent.settings.categoriesEmpty', icon: 'place' },
            {
                retry: () => intents?.retry(),
                more: () => undefined,
                items: rows,
            },
        )}`;
}

function colourFields(context: SectionContext, category: CategoryEditorPort, value: CategoryValuePort): TemplateResult {
    const { locale, intents } = context;
    const proposed = category.proposedColor;
    return html`${field(locale, {
            id: 'category-color',
            label: contentText(locale, 'adminContent.settings.color'),
            value: value.color,
            issue: issueAt(category.issues, 'color'),
            readOnly: context.readOnly,
            onInput: (text) => {
                intents?.editCategory({ color: text.trim() });
            },
        })}
        <div class="field">
            <label for="category-color-picker">${contentText(locale, 'adminContent.settings.seedPicker')}</label>
            <input
                id="category-color-picker"
                class="color"
                type="color"
                ?disabled=${context.readOnly}
                .value=${value.color}
                @input=${(event: Event) => intents?.editCategory({ color: (event.target as HTMLInputElement).value })}
            />
        </div>
        ${
            proposed === null
                ? nothing
                : html`<div class="alert" role="alert">
                      <hcm-icon name="warning"></hcm-icon>
                      <div class="alert-body">
                          <span>${contentText(locale, 'adminContent.settings.colorLowContrast')}</span>
                          <div class="actions">
                              ${swatch(proposed, value.icon)}
                              <hcm-button variant="text" ?disabled=${context.readOnly} @click=${() => intents?.useProposedColor()}
                                  >${contentText(locale, 'adminContent.settings.useColor', { hex: proposed })}</hcm-button
                              >
                          </div>
                      </div>
                  </div>`
        }`;
}

function iconPicker(context: SectionContext, value: CategoryValuePort): TemplateResult {
    const { locale, intents } = context;
    const labels = Object.fromEntries(POI_ICONS.map((icon) => [icon, contentText(locale, `adminContent.settings.icon.${icon}`)]));
    return html`<hcm-icon-picker
        .value=${value.icon}
        .labels=${labels}
        ?disabled=${context.readOnly}
        label=${contentText(locale, 'adminContent.settings.icon')}
        unbundled-text=${contentText(locale, 'adminContent.settings.iconUnbundled', { icon: value.icon })}
        @hcm-change=${(event: Event) => {
            intents?.editCategory({ icon: (event as CustomEvent<{ value: string }>).detail.value });
        }}
    ></hcm-icon-picker>`;
}

/** How many places use the category being deleted (0 while idle; a failed count asks for a target anyway). */
function inUseOf(state: CategoryDeletionPort): number {
    return state.phase === 'idle' ? 0 : (state.inUse ?? 1);
}

function targetField(context: SectionContext, category: CategoryEditorPort, inUse: number): TemplateResult | typeof nothing {
    const { locale, intents, view } = context;
    const others = view.categories.items.filter((item) => item.id !== category.id);
    const target = (event: Event): void => {
        const value = (event.target as HTMLSelectElement).value;
        intents?.setDeleteTarget(value === '' ? null : value);
    };
    return inUse === 0
        ? nothing
        : html`<p>${contentText(locale, 'adminContent.settings.deleteCategoryInUse', { count: String(inUse) })}</p>
              <div class="field">
                  <label for="delete-target">${contentText(locale, 'adminContent.settings.moveTo')}</label>
                  <select id="delete-target" @change=${target}>
                      <option value="">${contentText(locale, 'adminContent.settings.chooseTarget')}</option>
                      ${others.map((item) => html`<option value=${item.id}>${labelText(item.label, locale)}</option>`)}
                  </select>
              </div>`;
}

/** The name of the category being deleted, in the page's language (its saved name; the Romanian one until listed). */
function deletionName(context: SectionContext, state: CategoryDeletionPort): string {
    if (state.phase === 'idle') {
        return '';
    }
    const listed = context.view.categories.items.find((item) => item.id === state.id);
    return listed === undefined ? state.label : labelText(listed.label, context.locale);
}

/** Delete is off while the places are counted or deleted, and while places in use wait for their new category. */
function confirmBlocked(state: CategoryDeletionPort): boolean {
    return state.phase !== 'confirm' || (inUseOf(state) > 0 && state.target === null);
}

function deleteDialog(context: SectionContext, category: CategoryEditorPort, state: CategoryDeletionPort): TemplateResult {
    const { locale, intents } = context;
    const confirm = async (): Promise<void> => {
        if ((await intents?.confirmDeleteCategory()) === true) {
            context.go(['categories']);
        }
    };
    const cancel = (): void => {
        intents?.cancelDeleteCategory();
    };
    const name = deletionName(context, state);
    return html`<hcm-dialog
        .open=${state.phase === 'confirm' || state.phase === 'running'}
        .headline=${contentText(locale, 'adminContent.settings.deleteCategoryConfirm', { name })}
        .closeLabel=${contentText(locale, 'adminContent.settings.keepCategory')}
        @hcm-close=${cancel}
    >
        <div class="dialog-body">
            <p>${contentText(locale, 'adminContent.settings.deleteCategoryBody')}</p>
            ${targetField(context, category, inUseOf(state))}
        </div>
        <hcm-button slot="actions" variant="text" @click=${cancel}>${contentText(locale, 'adminContent.settings.keepCategory')}</hcm-button>
        <hcm-button
            slot="actions"
            class="confirm"
            variant="filled"
            ?disabled=${confirmBlocked(state)}
            @click=${() => {
                void confirm();
            }}
            >${contentText(locale, 'adminContent.settings.deleteCategory')}</hcm-button
        >
    </hcm-dialog>`;
}

function deletion(context: SectionContext, category: CategoryEditorPort): TemplateResult | typeof nothing {
    const { locale, intents } = context;
    const ask = (): void => {
        void intents?.askDeleteCategory();
    };
    return category.isNew
        ? nothing
        : html`<div class="actions">
                  <hcm-button variant="outlined" icon="delete" ?disabled=${context.readOnly} @click=${ask}
                      >${contentText(locale, 'adminContent.settings.deleteCategory')}</hcm-button
                  >
              </div>
              ${deleteDialog(context, category, context.view.categoryDeletion)}`;
}

function labelFields(context: SectionContext, category: CategoryEditorPort, value: CategoryValuePort): TemplateResult {
    const { locale, intents } = context;
    const keys = { ro: 'adminContent.settings.categoryLabelRo', en: 'adminContent.settings.categoryLabelEn' } as const;
    return html`<div class="fields">
        ${(['ro', 'en'] as const).map((lang) =>
            field(locale, {
                id: `category-label-${lang}`,
                label: contentText(locale, keys[lang]),
                value: value.label[lang] ?? '',
                issue: issueAt(category.issues, `label.${lang}`),
                readOnly: context.readOnly,
                ...(lang === 'ro' ? { required: true } : {}),
                onInput: (text) => {
                    intents?.setCategoryLabel(lang, text);
                },
            }),
        )}
    </div>`;
}

function opacitySlider(context: SectionContext, value: CategoryValuePort, title: string): TemplateResult {
    const { locale, intents } = context;
    const percent = Math.round(value.defaultOpacity * 100);
    return sliderRow({
        label: contentText(locale, 'adminContent.settings.defaultOpacity'),
        ...{
            min: 0,
            max: 100,
            value: percent,
            valueText: contentText(locale, 'adminContent.layers.percent', { percent: String(percent) }),
            disabled: context.readOnly,
        },
        onValue: (next) => {
            intents?.setCategoryOpacity(next);
        },
        onSettled: (next) => {
            context.announce(contentText(locale, 'adminContent.settings.overlayChanged', { name: title, percent: String(next) }));
        },
    });
}

function editorTop(context: SectionContext, category: CategoryEditorPort, title: string): TemplateResult {
    const { locale, intents } = context;
    const save = async (): Promise<void> => {
        const id = await intents?.saveCategory();
        if (typeof id === 'string' && category.isNew) {
            context.go(['categories', id]);
        }
    };
    const state = { ...saveStateOf(category), readOnly: context.readOnly };
    const handlers = {
        save: () => {
            void save();
        },
        discard: () => {
            intents?.discardCategory();
        },
    };
    const resolve = {
        keepMine: () => {
            intents?.keepMine();
        },
        takeTheirs: () => {
            intents?.takeTheirs();
        },
    };
    return html`<h2 tabindex="-1" data-detail-heading>${title}</h2>
        ${saveBar(locale, SETTINGS_SAVE_TEXTS, state, handlers)}
        ${conflictBanner(locale, SETTINGS_CONFLICT_TEXTS, category.conflict, { ...resolve, who: context.who, readOnly: context.readOnly })}
        <p><a href=${context.href(['categories'])}>${contentText(locale, 'adminContent.settings.backToCategories')}</a></p>`;
}

function editorBody(context: SectionContext, category: CategoryEditorPort, value: CategoryValuePort): TemplateResult {
    const { locale } = context;
    const title = category.isNew ? contentText(locale, 'adminContent.settings.newCategory') : labelText(value.label, locale);
    return html`${editorTop(context, category, title)} ${labelFields(context, category, value)}
        <section class="group">
            <h3>${contentText(locale, 'adminContent.settings.icon')}</h3>
            ${iconPicker(context, value)}
        </section>
        <section class="group">
            <h3>${contentText(locale, 'adminContent.settings.color')}</h3>
            ${colourFields(context, category, value)}
        </section>
        ${opacitySlider(context, value, title)} ${categoryDisplay(context, category, value)} ${deletion(context, category)}`;
}

function categoryEditor(context: SectionContext, category: CategoryEditorPort): TemplateResult {
    const { locale } = context;
    if (category.notFound) {
        return html`<h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.settings.categoryNotFound')}</h2>
            <p><a href=${context.href(['categories'])}>${contentText(locale, 'adminContent.settings.backToCategories')}</a></p>`;
    }
    const value = category.value;
    return value === null
        ? html`<h2 tabindex="-1" data-detail-heading>${sectionTitle(locale, 'categories')}</h2>`
        : editorBody(context, category, value);
}

/** The categories section: the open category's editor, or the list of categories. */
export function categoriesSection(context: SectionContext, drag: RowDrag): TemplateResult {
    const category = context.view.category;
    return category === null ? categoryList(context, drag) : categoryEditor(context, category);
}
