/**
 * Texts of the imagery census (M29, `docs/research/M29-imagery-census.md`): how many old images from above the chosen city has,
 * on the start page and in Setup's first step, in Romanian, the source of truth (`en.ts` is typed against it).
 */
export const ro = {
    'census.title': 'Imagini vechi din satelit pentru orașul ales',
    'census.waiting': 'Completați cele patru margini ale orașului ca să vedeți câte imagini vechi există.',
    'census.loading': 'Căutăm imaginile vechi ale orașului în catalogul public Landsat…',
    'census.total': 'Imagini găsite în total: între {low} și {high}',
    'census.free': 'Gratuite: între {low} și {high}',
    'census.paid': 'Cu plată: între {low} și {high} (scanare la cerere)',
    'census.landsat': 'Landsat (1972 – azi, gratuite): {count} imagini cu puțini nori, numărate exact acum.',
    'census.landsatMore': 'Landsat (1972 – azi, gratuite): peste {count} imagini cu puțini nori; numărătoarea s-a oprit aici.',
    'census.declassified': 'Fotografii spion desecretizate (1960 – 1984): estimare, nu număr exact.',
    'census.declassifiedFree': 'deja scanate, gratuite: între {low} și {high}',
    'census.declassifiedPaid': 'de scanat la cerere: între {low} și {high}, câte {scan} cadrul plus {fee} comanda',
    'census.unlock': 'Numărul exact al fotografiilor desecretizate apare după pasul USGS din Configurare (cont gratuit).',
    'census.unlockLink': 'Deschide pasul USGS',
    'census.previews': 'Cea mai clară imagine Landsat din fiecare deceniu',
    'census.preview': 'Anii {decade}: Landsat {mission}, {date}, nori {cloud} %',
    'census.noPreview': 'Catalogul nu are o previzualizare pentru această imagine.',
    'census.none': 'Catalogul nu are nicio imagine Landsat cu puțini nori pentru acest dreptunghi.',
    'census.source': 'Numărate în catalogul public Landsat al Microsoft Planetary Computer; estimarea desecretizatelor din {date}.',
    'census.failed.offline': 'Nu am putut ajunge la catalogul Landsat: browserul pare fără internet sau blochează adresa.',
    'census.failed.refused': 'Catalogul Landsat a refuzat căutarea acum, probabil fiind ocupat.',
    'census.failed.unreadable': 'Catalogul Landsat a răspuns într-o formă pe care aplicația nu o mai recunoaște.',
    'census.failed.help': 'Puteți continua fără numărătoare: imaginile se caută oricum după configurare. Încercați din nou peste un minut.',
    'census.retry': 'Caută din nou',
} as const;

export type CensusKey = keyof typeof ro;
