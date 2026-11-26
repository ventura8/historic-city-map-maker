/**
 * M28 (`docs/research/M28-sources.md` §10): Romania's archives, cadastre, military mapping agency and National Library, as
 * read on their own pages on the seed's `factsCheckedOn` (`country-seeds.ts`).
 */
import { MEANING_PLANS, letter } from './country-seed-parts.js';
import type { CountryPlace } from './country-sources.js';

export const RO_ARCHIVES: readonly CountryPlace[] = [
    {
        id: 'anrCentral',
        name: { ro: 'Arhivele Naționale ale României — sala de studiu', en: 'National Archives of Romania — reading room' },
        kind: 'archive',
        access: 'offline',
        cost: 'mixed',
        costNote: {
            ro:
                'Permisul de cercetare este gratuit. Fotografii proprii: 7 lei pe zi, fără bliț. Copie xerox: 1 leu pe pagină. Copie ' +
                'digitală pe aparatura arhivei: 1 leu pe pagină; copii făcute de personal: cel mult 300 de pagini pe lună, în 30 de ' +
                'zile lucrătoare.',
            en:
                'The research permit is free. Your own photos: 7 lei a day, no flash. Photocopy: 1 leu a page. Digital copy on the ' +
                'archive’s equipment: 1 leu a page; copies made by the staff: up to 300 pages a month, within 30 working days.',
        },
        years: { from: 1700, to: 1958 },
        materials: ['historicalMaps', 'cadastralPlans', 'cityPlans'],
        holdings: {
            ro:
                '„Planuri Județe, Lit A-N 1704-1958” (inv. 2342), „Planuri Județe, Lit O-V 1704-1958” (inv. 2343), „Planuri și ' +
                'Hotărnicii 1700-1915” (inv. 2473).',
            en:
                '“Planuri Județe, Lit A-N 1704-1958” (inv. 2342), “Planuri Județe, Lit O-V 1704-1958” (inv. 2343), “Planuri și ' +
                'Hotărnicii 1700-1915” (inv. 2473).',
        },
        url: 'https://arhivelenationale.ro/site/sala-de-studiu/',
        verified: true,
        offline: {
            address: 'Bulevardul Regina Elisabeta 49, București',
            hours: {
                ro:
                    'Luni și miercuri 8:30–15:30, marți și joi 8:30–18:30, vineri 8:30–13:30; ultima intrare cu 30 de minute înainte de ' +
                    'închidere. Intrarea este din strada Gutenberg (metrou Izvor sau Universitate).',
                en:
                    'Monday and Wednesday 8:30–15:30, Tuesday and Thursday 8:30–18:30, Friday 8:30–13:30; last entry 30 minutes before ' +
                    'closing. The entrance is on Gutenberg Street (metro Izvor or Universitate).',
            },
            phone: '021 303 70 80',
            email: 'saladestudiu@arhivelenationale.ro',
            access: {
                ro:
                    'Cereți permisul de cercetare (gratuit, valabil doi ani în toate sălile de studiu ale arhivelor) prin e-mail sau la ' +
                    'sală și ridicați-l cu actul de identitate. Comandați dosarele din inventare cu cel puțin 3 zile lucrătoare ' +
                    'înainte: cel mult 15 dosare, 20 de fotografii și 5 hărți pe zi. Aduceți actul de identitate și creioane (pixurile ' +
                    'nu sunt permise).',
                en:
                    'Ask for the research permit (free, valid two years in every reading room of the archives) by email or at the room, ' +
                    'and collect it with your ID. Order the files from the inventories at least 3 working days ahead: at most 15 files, ' +
                    '20 photographs and 5 maps a day. Bring your ID and pencils (pens are not allowed).',
            },
            request: letter(
                'Cerere permis de cercetare și consultare planuri — {city}',
                'Aș dori un permis de cercetare și să consult planurile din fondurile „Planuri Județe” (inv. 2342, 2343) și ' +
                    '„Planuri și Hotărnicii 1700-1915” (inv. 2473).',
            ),
            requestMeaning: MEANING_PLANS,
            fees: {
                ro: 'Fotografii proprii 7 lei pe zi; xerox 1 leu pe pagină; copie digitală 1 leu pe pagină.',
                en: 'Your own photos 7 lei a day; photocopy 1 leu a page; digital copy 1 leu a page.',
            },
            importRoute: 'localImport',
        },
    },
    {
        id: 'anrBucharest',
        name: {
            ro: 'Arhivele Naționale — Serviciul Municipiului București',
            en: 'National Archives — Bucharest Municipal Service',
        },
        kind: 'archive',
        access: 'offline',
        cost: 'unknown',
        materials: ['cityPlans', 'historicalMaps'],
        holdings: {
            ro: 'Fondul „Primăria Orașului București”: cereți planurile orașului din acest fond.',
            en: 'The fonds “Primăria Orașului București” (Bucharest City Hall): ask for the city plans in it.',
        },
        url: 'https://arhivelenationale.ro/site/directii-judetene/bucuresti/',
        verified: true,
        offline: {
            address: 'Calea Văcărești 470, București',
            hours: {
                ro:
                    'Sala de studiu: marți și miercuri 8:30–13:00, joi 12:00–16:30 (interior 15261). Sala anunță uneori închideri pe ' +
                    'site: verificați înainte să mergeți.',
                en:
                    'Reading room: Tuesday and Wednesday 8:30–13:00, Thursday 12:00–16:30 (extension 15261). The room sometimes ' +
                    'announces closures on its site: check before you go.',
            },
            phone: '021 303 70 80',
            email: 'salastudiu.smban@arhivelenationale.ro',
            access: {
                ro: 'Același permis de cercetare ca la sala centrală a Arhivelor Naționale. Aduceți actul de identitate.',
                en: 'The same research permit as at the National Archives’ central room. Bring your ID.',
            },
            request: letter(
                'Consultare planuri din fondul Primăria Orașului București — {city}',
                'Aș dori să consult planurile orașului din fondul „Primăria Orașului București”.',
            ),
            requestMeaning: MEANING_PLANS,
            fees: {
                ro: 'Tarifele acestui serviciu nu sunt publicate separat; întrebați în scrisoare.',
                en: 'This branch publishes no fees of its own; the letter asks for them.',
            },
            importRoute: 'localImport',
        },
    },
    {
        id: 'ancpi',
        name: {
            ro: 'Agenția Națională de Cadastru și Publicitate Imobiliară (ANCPI)',
            en: 'National Agency for Cadastre and Land Registration (ANCPI)',
        },
        kind: 'cadastre',
        access: 'offline',
        cost: 'paid',
        costNote: {
            ro:
                'Din Ordinul ANCPI 16/2019: hărți și planuri (raster) 40 lei pe foaie, orice format A4–A0; ortofotoplan cu pixel de cel ' +
                'mult 20 cm 1.000 lei pe km², 20–50 cm 500 lei pe km², de cel puțin 50 cm 20 lei pe km² (o parte de km² se plătește ca ' +
                'un km² întreg); copii certificate din arhivă 25 lei pe dosar.',
            en:
                'From ANCPI Order 16/2019: maps and plans (raster) 40 lei a sheet, any size A4–A0; orthophoto with pixels of 20 cm or ' +
                'less 1,000 lei a km², 20–50 cm 500 lei a km², 50 cm or more 20 lei a km² (part of a km² is billed as a whole one); ' +
                'certified copies from the archive 25 lei a file.',
        },
        materials: ['aerialPhotos', 'cadastralPlans', 'historicalMaps'],
        url: 'https://www.ancpi.ro/',
        verified: true,
        offline: {
            address: 'Splaiul Independenței 202A, București 060022',
            hours: {
                ro: 'Programul cu publicul nu era publicat pe pagina citită: sunați înainte.',
                en: 'The opening hours were not on the page we read: call before you go.',
            },
            phone: '+40 21 317 73 39',
            access: {
                ro: 'Trimiteți cererea scrisă (de mai jos); agenția vă spune unde și când ridicați foile sau fișierele.',
                en: 'Send the written request (below); the agency tells you where and when to collect the sheets or files.',
            },
            request: letter(
                'Cerere hărți, planuri și ortofotoplanuri — {city}',
                'Aș dori să cumpăr hărți și planuri vechi (raster) și ortofotoplanuri ale orașului, conform Ordinului ANCPI 16/2019.',
            ),
            requestMeaning: MEANING_PLANS,
            fees: {
                ro: '40 lei pe foaie de hartă sau plan; ortofotoplanuri de la 20 la 1.000 lei pe km², după rezoluție.',
                en: '40 lei a map or plan sheet; orthophotos from 20 to 1,000 lei a km², by resolution.',
            },
            importRoute: 'imageryUpload',
        },
    },
    {
        id: 'aiga',
        name: {
            ro: 'Agenția de Informații Geospațiale a Apărării „Gl. div. Constantin Barozzi”',
            en: 'Defence Geospatial Information Agency (formerly the Military Topographic Directorate)',
        },
        kind: 'military',
        access: 'both',
        cost: 'unknown',
        costNote: {
            ro: 'Prețurile nu sunt publicate; agenția răspunde cererii.',
            en: 'No price list is published; the agency answers the request.',
        },
        materials: ['historicalMaps', 'cityPlans', 'aerialPhotos'],
        holdings: {
            ro: 'Lista hărților scanate include „Planul topografic al Bucureștilor, 1:15.000”.',
            en: 'Its list of scanned maps includes a “Topographic Plan of Bucharest, 1:15,000”.',
        },
        url: 'https://geomil.ro/',
        verified: true,
        online: {
            key: 'none',
            howTo: {
                ro:
                    'Deschideți geoportalul agenției, căutați orașul, priviți hărțile și descărcați-le pe cele care se pot descărca; ' +
                    'apoi aduceți fișierul în aplicație.',
                en:
                    'Open the agency’s geoportal, search for the city, look at the maps and download those offered for download; then ' +
                    'bring the file into the app.',
            },
            importRoute: 'imageryUpload',
        },
        offline: {
            address: 'Bulevardul Ion Mihalache 124-126, București 011203',
            hours: { ro: 'Luni–vineri 8:00–14:00.', en: 'Monday to Friday 8:00–14:00.' },
            phone: '021 224 26 51',
            email: 'contact.AIGA@mapn.ro',
            access: {
                ro:
                    'Persoanele fizice și juridice pot cere hărți conform Legii 8/1996 și Ordinului M.82/2008: spuneți în cerere scopul ' +
                    'și dovedirea nevoii.',
                en:
                    'Private persons and companies may request maps under Law 8/1996 and Order M.82/2008: the request states its ' +
                    'purpose and why you need them.',
            },
            request: letter(
                'Cerere hărți topografice istorice — {city}',
                'Aș dori copii ale planurilor topografice istorice ale orașului (de exemplu „Planul topografic al Bucureștilor, ' +
                    '1:15.000”), în scop documentar, pentru o hartă istorică publică.',
            ),
            requestMeaning: MEANING_PLANS,
            fees: { ro: 'Nepublicate; agenția le comunică.', en: 'Not published; the agency states them.' },
            importRoute: 'imageryUpload',
        },
    },
    {
        id: 'bnr',
        name: { ro: 'Biblioteca Națională a României — Cartografie', en: 'National Library of Romania — Maps' },
        kind: 'library',
        access: 'offline',
        cost: 'paid',
        costNote: {
            ro:
                'Permis de cititor: 332 lei pe an, 200 lei pe 6 luni, 44,5 lei pe lună (jumătate pentru elevi, studenți și pensionari). ' +
                'Scanările le face doar personalul, după o cerere scrisă; tarifele lor nu sunt publicate.',
            en:
                'Reader’s card: 332 lei a year, 200 lei for 6 months, 44.5 lei a month (half for pupils, students and pensioners). ' +
                'Scans are made by the staff only, after a written request; their fees are not published.',
        },
        materials: ['historicalMaps', 'cityPlans'],
        holdings: { ro: 'Circa 5.000 de hărți, din secolul al XVI-lea până azi.', en: 'About 5,000 maps, from the 16th century to today.' },
        url: 'https://bibnat.ro/cartografie/',
        verified: true,
        offline: {
            address: 'Bulevardul Unirii 22, București 030833',
            hours: {
                ro:
                    'Sala Alexandre Saint-Georges (etajul V, corp A, camera 520): luni–vineri 9:00–17:00. Trimiteți cererea de ' +
                    'consultare cu o zi înainte.',
                en:
                    'Alexandre Saint-Georges room (5th floor, wing A, room 520): Monday to Friday 9:00–17:00. Send the consultation ' +
                    'request a day ahead.',
            },
            email: 'colectii.speciale@bibnat.ro',
            access: {
                ro:
                    'Faceți permisul de cititor cu actul de identitate și o fotografie. Fotografiile proprii nu sunt permise: scanările ' +
                    'le face personalul.',
                en: 'Get the reader’s card with your ID and a photo. Your own photos are not allowed: the staff make the scans.',
            },
            request: letter(
                'Cerere de consultare și scanare a hărților — {city}',
                'Aș dori să consult hărțile și planurile vechi ale orașului din colecția de cartografie și să cer scanarea celor de ' +
                    'care am nevoie.',
            ),
            requestMeaning: MEANING_PLANS,
            fees: {
                ro: 'Permisul de cititor (de la 44,5 lei pe lună); scanările, la tariful pe care vi-l comunică biblioteca.',
                en: 'The reader’s card (from 44.5 lei a month); scans at the price the library gives you.',
            },
            importRoute: 'localImport',
        },
    },
];
