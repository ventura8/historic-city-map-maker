/**
 * Romanian texts of the admin's M5 cities (`docs/research/M5-interfaces.md` §1.6, §1.8): the New city flow, its done
 * screen and a city's budgets. The source of truth for `AdminCitiesKey`; `en.ts` is typed against it. Merged into
 * `translateAdminContent` by `../admin-content/index.ts`. One entry per line (scripts/ci/check_i18n.py); every key carries
 * its section's prefix (`packages/shared/test/i18n-admin.test.ts`). The switcher's texts are the shell's
 * (`adminShell.city.*`). Owner: multi-city (the contracts agent wrote the texts the contract names).
 */
export const ro = {
    // [section cities] owner: multi-city; keys adminContent.cities.*
    'adminContent.cities.new.title': 'Oraș nou',
    'adminContent.cities.new.intro': 'Un nume și zona de pe hartă: restul se completează singur și se schimbă oricând în Setări.',
    'adminContent.cities.new.nameRo': 'Numele în română',
    'adminContent.cities.new.nameEn': 'Numele în engleză (opțional)',
    'adminContent.cities.new.id': 'Identificator',
    'adminContent.cities.new.idHelp': 'Litere mici, cifre și cratime; apare în adrese: /{cityId}/.',
    'adminContent.cities.new.idInvalid': 'Un identificator are 2–32 litere mici, cifre sau cratime și nu e un cuvânt rezervat (ca engine).',
    'adminContent.cities.new.area': 'Zona orașului',
    'adminContent.cities.new.areaHelp': 'Trage pe hartă un dreptunghi peste oraș.',
    'adminContent.cities.new.located': 'Găsit pe OpenStreetMap: {place}. Ajustează dreptunghiul dacă trebuie.',
    'adminContent.cities.new.edgesIncomplete': 'Completează toate cele patru laturi ca să desenezi dreptunghiul.',
    'adminContent.cities.new.areaBounds': 'Vestul trebuie să fie mai mic decât estul, iar sudul mai mic decât nordul.',
    'adminContent.cities.new.areaTooSmall': 'Zona este prea mică: trage un dreptunghi mai mare.',
    'adminContent.cities.new.areaTooBig': 'Zona este prea mare: cel mult 2 grade pe fiecare latură.',
    'adminContent.cities.new.moveMap': 'Mută harta',
    'adminContent.cities.new.drawArea': 'Desenează zona',
    'adminContent.cities.new.areaLimits': 'Fiecare latură: {min}–{max} grade. Trage dintr-un colț în altul sau dă clic pe ambele colțuri.',
    'adminContent.cities.new.create': 'Creează orașul',
    'adminContent.cities.new.creating': 'Se creează orașul…',
    'adminContent.cities.created.title': 'Orașul {city} a fost creat',
    'adminContent.cities.created.unpublished': 'Orașul nu este public încă: îl publici din Setări când e gata.',
    'adminContent.cities.created.harvest': 'Căutăm imagini istorice ale zonei: primele apar în câteva minute.',
    'adminContent.cities.created.harvestLater': 'Imaginile istorice ale zonei se caută după ce configurezi USGS (Setup).',
    'adminContent.cities.created.next': 'Ce urmează',
    'adminContent.cities.created.photos': 'Adaugă fotografii',
    'adminContent.cities.created.places': 'Desenează locuri',
    'adminContent.cities.created.imagery': 'Vezi imaginile istorice',
    'adminContent.cities.created.siteLater': 'Odată publicat, vizitatorii îi găsesc harta la această adresă:',
    'adminContent.cities.created.exportInstead': 'Exportă orașul din Setări face și o copie pentru orice găzduire statică.',
    'adminContent.cities.newTab': '(se deschide într-o filă nouă)',
    // [end cities]
    // [section budgets] owner: multi-city; keys adminContent.budgets.*
    'adminContent.budgets.title': 'Bugetul orașului',
    'adminContent.budgets.intro': 'Partea orașului din bugetele proiectului; limitele proiectului rămân valabile pentru toate.',
    'adminContent.budgets.computeUnits': 'Unități de calcul Mapbox pe lună',
    'adminContent.budgets.rasterJobs': 'Procesări de imagini pe zi',
    'adminContent.budgets.aiRequests': 'Traduceri automate pe lună',
    'adminContent.budgets.geocodeCells': 'Sugestii de titlu pe zi',
    'adminContent.budgets.exports': 'Exporturi pe zi',
    'adminContent.budgets.projectCapsOnly': 'Nu are încă limite proprii: îl țin doar plafoanele proiectului. Un câmp gol rămâne la plafon.',
    'adminContent.budgets.usedNoLimit': 'Folosit până acum în această perioadă: {used}',
    'adminContent.budgets.used': 'Folosite până acum în această perioadă: {used} din {limit}',
    'adminContent.budgets.saved': 'Bugetul orașului a fost salvat.',
    'adminContent.budgets.invalid': 'Fiecare limită este un număr de la 0 până la plafonul proiectului.',
    'adminContent.budgets.ownerOnly': 'Doar proprietarul proiectului schimbă bugetele orașelor.',
    // [end budgets]
} as const;

export type AdminCitiesKey = keyof typeof ro;
