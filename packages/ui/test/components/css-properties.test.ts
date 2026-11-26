import { html, render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { cssProperties } from '../../src/components/css-properties.js';

describe('cssProperties', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_setsPropertiesThroughTheCssomOnEveryRender', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const draw = (position: string): void => {
            render(html`<div ${cssProperties({ '--hcm-position': position, 'inline-size': '10px' })}></div>`, host);
        };

        draw('40%');
        const target = host.querySelector('div');
        expect(target?.style.getPropertyValue('--hcm-position')).toBe('40%');
        expect(target?.style.inlineSize).toBe('10px');

        draw('75%');
        expect(target?.style.getPropertyValue('--hcm-position')).toBe('75%');

        draw('');
        expect(target?.style.getPropertyValue('--hcm-position')).toBe('');
        expect(target?.style.inlineSize).toBe('10px');
        expect(target?.getAttribute('style')).not.toContain('--hcm-position');
    });

    it('happyPath_anAbsentValueIsNeverWrittenAndRemovesAnEarlierOne', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const draw = (colour: string | undefined): void => {
            render(html`<span ${cssProperties({ '--swatch': colour })}></span>`, host);
        };

        draw(undefined);
        const target = host.querySelector('span');
        expect(target?.hasAttribute('style')).toBe(false);

        draw('#8b5e3c');
        expect(target?.style.getPropertyValue('--swatch')).toBe('#8b5e3c');

        draw(undefined);
        expect(target?.style.getPropertyValue('--swatch')).toBe('');
    });

    it('badPath_anAttributeBindingIsRefused', () => {
        const host = document.createElement('div');

        expect(() => {
            render(html`<div style=${cssProperties({ '--hcm-position': '1%' })}></div>`, host);
        }).toThrow('cssProperties binds an element only');
    });
});
