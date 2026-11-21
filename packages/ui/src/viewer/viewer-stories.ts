/** The `stories` sheet (M17, V50): the list or one story, modal or docked as the viewer's other sheets. */
import { translate, type Manifest, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { Placement } from './layout.js';
import { renderSheetFrame } from './sheet-frame.js';
import { localizedText } from './text.js';

/** What the sheet needs of the viewer's view and state. */
interface StoriesView {
    readonly locale: ViewerLocale;
    readonly manifestUrl: string;
    readonly storyId: string | null;
}

/** The sheet's two events besides closing: a photo or a place to open. */
export interface StoriesHandlers {
    readonly onSheetClose: (event: Event) => void;
    readonly onStorySelect: (event: CustomEvent<{ readonly storyId: string | null }>) => void;
    readonly onPhotoSelect: (event: CustomEvent<{ readonly photoId: string }>) => void;
    readonly onPoiSelect: (event: CustomEvent<{ readonly poiId: string }>) => void;
}

export function storiesSheet(view: StoriesView, manifest: Manifest, placement: Placement, handlers: StoriesHandlers): TemplateResult {
    const stories = manifest.stories ?? [];
    const story = stories.find((candidate) => candidate.id === view.storyId);
    const content = html`<hcm-stories
        .stories=${stories}
        .storyId=${view.storyId}
        .photos=${[...manifest.photos, ...(manifest.unplaced ?? [])]}
        .pois=${manifest.pois ?? []}
        .locale=${view.locale}
        .manifestUrl=${view.manifestUrl}
    ></hcm-stories>`;
    const frame = {
        ...placement,
        label: story === undefined ? translate(view.locale, 'stories.title') : localizedText(story.title, view.locale),
        closeLabel: translate(view.locale, 'action.close'),
        handleLabel: translate(view.locale, 'sheet.resize'),
        onClose: (): void => {
            handlers.onSheetClose(new CustomEvent('hcm-close'));
        },
    };
    return html`<div
        class="stories-sheet"
        ?inert=${placement.inert === true}
        @hcm-close=${handlers.onSheetClose}
        @hcm-story-select=${handlers.onStorySelect}
        @hcm-photo-select=${handlers.onPhotoSelect}
        @hcm-poi-select=${handlers.onPoiSelect}
    >
        ${renderSheetFrame(frame, content)}
    </div>`;
}
