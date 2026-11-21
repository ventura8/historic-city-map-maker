import { describe, expect, it } from 'vitest';

import { licenseText, localizedText, photoCountText, photoDateText, photoSourceText, poiYearsText } from '../../src/viewer/text.js';

describe('localizedText', () => {
    it('happyPath_picksTheLocaleText', () => {
        expect(localizedText({ ro: 'Strada', en: 'Street' }, 'ro')).toBe('Strada');
        expect(localizedText({ ro: 'Strada', en: 'Street' }, 'en')).toBe('Street');
    });

    it('badPath_missingEnglishFallsBackToRomanian', () => {
        expect(localizedText({ ro: 'Strada' }, 'en')).toBe('Strada');
    });
});

describe('photoSourceText', () => {
    it('happyPath_itsNameElseItsHost', () => {
        expect(photoSourceText({ url: 'https://arhiva.example/a?b=c', label: 'Arhiva' })).toBe('Arhiva');
        expect(photoSourceText({ url: 'https://arhiva.example/a?b=c' })).toBe('arhiva.example');
    });

    it('badPath_anAddressThatIsNotHttpsStaysAsWritten', () => {
        expect(photoSourceText({ url: 'not an address' })).toBe('not an address');
    });
});

describe('photoDateText', () => {
    it('happyPath_prefersTheSourcesOwnDating', () => {
        expect(photoDateText({ year: 1936, dateText: { ro: 'Iulie 1936', en: 'July 1936' } }, 'en')).toBe('July 1936');
    });

    it('happyPath_showsTheDateAtItsPrecision', () => {
        expect(photoDateText({ year: 1936, month: 7 }, 'en')).toBe('July 1936');
        expect(photoDateText({ year: 1936, month: 7 }, 'ro')).toBe('Iulie 1936');
        expect(photoDateText({ year: 1936, month: 7, day: 12 }, 'en')).toBe('12 July 1936');
        expect(photoDateText({ year: 1936, month: 7, day: 12 }, 'ro')).toBe('12 iulie 1936');
    });

    it('happyPath_theSourcesOwnDatingStaysFirst', () => {
        expect(photoDateText({ year: 1936, month: 7, dateText: { ro: 'Vara lui 1936' } }, 'ro')).toBe('Vara lui 1936');
    });

    it('happyPath_showsOneYearOrARange', () => {
        expect(photoDateText({ year: 1978 }, 'ro')).toBe('Anul 1978');
        expect(photoDateText({ year: 1978, yearEnd: 1978 }, 'en')).toBe('Year 1978');
        expect(photoDateText({ year: 1978, yearEnd: 1979 }, 'ro')).toBe('Anii 1978–1979');
    });

    it('badPath_undatedPhotoSaysSo', () => {
        expect(photoDateText({}, 'ro')).toBe('An necunoscut');
        expect(photoDateText({}, 'en')).toBe('Unknown year');
    });
});

describe('poiYearsText', () => {
    it('happyPath_closedOpenAndSingleSpans', () => {
        expect(poiYearsText({ yearStart: 1900, yearEnd: 1986 }, 'ro')).toBe('Între 1900 și 1986');
        expect(poiYearsText({ yearStart: 1900, yearEnd: 1900 }, 'ro')).toBe('Anul 1900');
        expect(poiYearsText({ yearStart: 1890 }, 'en')).toBe('From 1890');
        expect(poiYearsText({ yearEnd: 1984 }, 'ro')).toBe('Până în 1984');
        expect(poiYearsText({ yearSeen: 1939 }, 'ro')).toBe('Văzută pe harta din 1939');
        expect(poiYearsText({ yearSeen: 1914 }, 'en')).toBe('Seen on the 1914 map');
    });

    it('badPath_noYearsGivesNoText', () => {
        expect(poiYearsText({}, 'ro')).toBeNull();
    });
});

describe('photoCountText', () => {
    it('happyPath_romanianPluralForms', () => {
        expect(photoCountText(1, 'ro')).toBe('1 fotografie');
        expect(photoCountText(3, 'ro')).toBe('3 fotografii');
        expect(photoCountText(20, 'ro')).toBe('20 de fotografii');
    });

    it('happyPath_englishPluralForms', () => {
        expect(photoCountText(1, 'en')).toBe('1 photo');
        expect(photoCountText(3, 'en')).toBe('3 photos');
    });

    it('badPath_zeroUsesTheFewFormInRomanian', () => {
        expect(photoCountText(0, 'ro')).toBe('0 fotografii');
    });
});

describe('licenseText', () => {
    it('happyPath_localizedLicence', () => {
        expect(licenseText('PD', 'ro')).toBe('Domeniu public');
        expect(licenseText('CC-BY-4.0', 'en')).toBe('CC BY 4.0');
    });
});
