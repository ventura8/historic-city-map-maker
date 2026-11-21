/** Registers the stories page and what it renders (M17, `docs/research/M17-stories.md` §6); idempotent per registry. */
import { defineUiKit } from '../../components/define.js';
import { defineEditingElements } from '../editing/define.js';
import { defineHcmStoriesPage } from './hcm-stories-page.js';

export function defineStoriesElements(registry: CustomElementRegistry = customElements): void {
    defineUiKit(registry);
    defineEditingElements(registry);
    defineHcmStoriesPage(registry);
}
