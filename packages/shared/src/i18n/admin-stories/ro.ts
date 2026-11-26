/**
 * The stories area's texts (M17, `docs/research/M17-stories.md` §6), Romanian: the source of truth of `AdminStoriesKey`;
 * `en.ts` is typed against it. One entry per line (scripts/ci/check_i18n.py).
 */
export const ro = {
    // [section stories] owner: stories; keys adminContent.stories.*
    'adminContent.stories.title': 'Povești',
    'adminContent.stories.listLabel': 'Poveștile orașului',
    'adminContent.stories.detailLabel': 'Povestea',
    'adminContent.stories.empty': 'Nicio poveste încă. Scrie prima: un titlu, apoi textul.',
    'adminContent.stories.choose': 'Alege o poveste ca s-o scrii sau s-o citești.',
    'adminContent.stories.newTitle': 'Titlul noii povești (în română)',
    'adminContent.stories.create': 'Poveste nouă',
    'adminContent.stories.created': 'Povestea a fost creată nepublicată. Scrie-i textul, apoi public-o.',
    'adminContent.stories.createdPending': 'Povestea a fost creată. După ce o scrii, așteaptă verificarea unui moderator.',
    'adminContent.stories.notFound': 'Nicio poveste la această adresă.',
    'adminContent.stories.unpublished': 'Nepublicată',
    'adminContent.stories.pending': 'Așteaptă verificarea',
    'adminContent.stories.refused': 'Refuzată',
    'adminContent.stories.titleRo': 'Titlul (română)',
    'adminContent.stories.titleEn': 'Titlul (engleză)',
    'adminContent.stories.bodyRo': 'Textul (română)',
    'adminContent.stories.bodyEn': 'Textul (engleză)',
    'adminContent.stories.format': 'Un rând gol între paragrafe; **aldin**, _cursiv_, [text](https://…) pentru o legătură.',
    'adminContent.stories.formatPhoto': 'O fotografie a orașului, pe un rând al ei: ![legendă](photo:id).',
    'adminContent.stories.yearStart': 'Din anul',
    'adminContent.stories.yearEnd': 'Până în anul',
    'adminContent.stories.photos': 'Fotografiile poveștii',
    'adminContent.stories.places': 'Locurile poveștii',
    'adminContent.stories.addPhoto': 'Adaugă o fotografie',
    'adminContent.stories.addPlace': 'Adaugă un loc',
    'adminContent.stories.pick': 'Caută după titlu',
    'adminContent.stories.remove': 'Scoate {title}',
    'adminContent.stories.published': 'Publicată pe harta publică',
    'adminContent.stories.publishedHelp': 'O poveste publicată are nevoie de text.',
    'adminContent.stories.waitsHelp': 'O verifică un moderator; apoi apare pe harta publică.',
    'adminContent.stories.state.saved': 'Salvată',
    'adminContent.stories.state.unsaved': 'Modificări nesalvate',
    'adminContent.stories.state.saving': 'Se salvează…',
    'adminContent.stories.saved': 'Povestea e salvată. Harta publică se actualizează în circa un minut.',
    'adminContent.stories.conflict': 'Altcineva a modificat povestea între timp: {fields}.',
    'adminContent.stories.keepMine': 'Păstrează modificările mele',
    'adminContent.stories.takeTheirs': 'Ia versiunea salvată',
    'adminContent.stories.delete': 'Șterge povestea',
    'adminContent.stories.deleteTitle': 'Ștergi „{title}”?',
    'adminContent.stories.deleteBody': 'Povestea dispare de pe harta publică în circa un minut. O poți readuce din Versiuni.',
    'adminContent.stories.deleted': 'Povestea a fost ștearsă.',
    'adminContent.stories.versions': 'Versiunile poveștii',
    // [end stories]
} as const;

export type AdminStoriesKey = keyof typeof ro;
