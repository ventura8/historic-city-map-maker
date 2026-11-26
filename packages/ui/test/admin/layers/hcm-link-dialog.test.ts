import { html, render } from 'lit';
import { describe, expect, it } from 'vitest';

import { defineHcmLinkDialog } from '../../../src/admin/layers/hcm-link-dialog.js';

describe('<hcm-link-dialog> (§252)', () => {
    it('badPath_withNoInputItDrawsNothingAndDefiningTwiceIsHarmless', async () => {
        defineHcmLinkDialog();
        defineHcmLinkDialog();
        const host = document.createElement('div');
        document.body.append(host);
        render(html`<hcm-link-dialog></hcm-link-dialog>`, host);
        const element = host.querySelector('hcm-link-dialog');
        await element?.updateComplete;
        expect(element?.children.length).toBe(0);
        host.remove();
    });
});
