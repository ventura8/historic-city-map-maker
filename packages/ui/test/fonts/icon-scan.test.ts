/**
 * The icon names `build-fonts.mjs --check` finds in the sources (`packages/ui/src/fonts/icon-scan.ts`): the literals and the
 * literal outcomes of a hole, never a text that merely looks like one.
 */
import { describe, expect, it } from 'vitest';

import { iconNamesIn } from '../../src/fonts/icon-scan.js';

describe('iconNamesIn', () => {
    it('happyPath_literalsOfAnIconSetting', () => {
        expect(iconNamesIn(`<hcm-button icon="add"></hcm-button> { icon: 'map' } <hcm-icon name="place"></hcm-icon>`)).toEqual([
            'add',
            'map',
            'place',
        ]);
    });

    it('happyPath_aHolesLiteralOutcomes', () => {
        const source = [
            `<hcm-icon name=\${failed ? 'error' : 'system_update'}></hcm-icon>`,
            `<hcm-button icon=\${place === 'local' ? 'play_arrow' : 'cloud'}></hcm-button>`,
            `<hcm-icon aria-hidden="true" name=\${off === undefined ? ICONS.ok : 'info'}></hcm-icon>`,
            `<hcm-button .icon=\${'done_all'}></hcm-button>`,
        ].join('\n');

        expect(iconNamesIn(source)).toEqual(['error', 'system_update', 'play_arrow', 'cloud', 'info', 'done_all']);
    });

    it('badPath_noTextThatOnlyLooksLikeOne', () => {
        const source = [
            // Any other element's name, a hole with no literal outcome, an operand, and a word in a text.
            `<input name="title" /> <hcm-switch name=\${field ? 'one' : 'two'}></hcm-switch>`,
            `<hcm-icon name=\${ICONS[chip.state]}></hcm-icon> <hcm-button icon=\${this.icon}></hcm-button>`,
            `<hcm-button icon=\${kind === 'local' ? this.first : this.second}></hcm-button>`,
            `const words = 'the icon name is here'; const name = 'x'; const iconic = "y";`,
            `<hcm-icon class="big"></hcm-icon> name="after"`,
        ].join('\n');

        expect(iconNamesIn(source)).toEqual([]);
    });
});
