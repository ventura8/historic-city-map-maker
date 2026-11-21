import type { AdminCitiesKey } from './ro.js';

/**
 * The `packages/shared/src/i18n/admin-cities` family's texts in `fr`, imported by scripts/i18n/import_translations.py (docs/I18N.md).
 * Partial while the translation goes on: a key not here shows in English.
 */
export const fr: Readonly<Partial<Record<AdminCitiesKey, string>>> = {
    'adminContent.cities.new.title': 'Nouvelle ville',
    'adminContent.cities.new.intro':
        'Un nom et une zone sur la carte : le reste se remplit automatiquement et peut être modifié à tout moment dans les paramètres.',
    'adminContent.cities.new.nameRo': 'Nom en roumain',
    'adminContent.cities.new.nameEn': 'Nom en anglais (facultatif)',
    'adminContent.cities.new.id': 'Identifiant',
    'adminContent.cities.new.idHelp': 'Minuscules, chiffres et tirets ; utilisé dans les adresses : /{cityId}/.',
    'adminContent.cities.new.idInvalid':
        'Un identifiant doit contenir de 2 à 32 caractères : lettres minuscules, chiffres ou tirets, et ne doit pas être un mot réservé (comme « engine »).',
    'adminContent.cities.new.area': 'La zone de la ville',
    'adminContent.cities.new.areaHelp': 'Tracez un rectangle sur la carte, englobant la ville.',
    'adminContent.cities.new.located': 'Trouvé sur OpenStreetMap : {place}. Ajustez le rectangle si nécessaire.',
    'adminContent.cities.new.edgesIncomplete': 'Remplissez les quatre côtés pour dessiner le rectangle.',
    'adminContent.cities.new.areaBounds': 'L’ouest doit être inférieur à l’est, et le sud à l’est, et le sud doit être inférieur au nord.',
    'adminContent.cities.new.areaTooSmall': 'La zone est trop petite : tracez un rectangle plus grand.',
    'adminContent.cities.new.areaTooBig': 'La zone est trop vaste : elle ne doit pas dépasser 2 degrés par côté.',
    'adminContent.cities.new.moveMap': 'Déplacer la carte',
    'adminContent.cities.new.drawArea': 'Délimitez la zone.',
    'adminContent.cities.new.areaLimits':
        'Chaque côté : de {min} à {max} degrés. Faites glisser le curseur d’un coin à l’autre, ou cliquez sur les deux coins.',
    'adminContent.cities.new.create': 'Créer la ville',
    'adminContent.cities.new.creating': 'Création de la ville…',
    'adminContent.cities.created.title': 'La ville de {city} a été créée.',
    'adminContent.cities.created.unpublished':
        'La ville n’est pas encore publique : publiez-la depuis les Paramètres une fois qu’elle est prête.',
    'adminContent.cities.created.harvest':
        "Recherche d'images historiques de la zone : les premières devraient apparaître dans quelques minutes.",
    'adminContent.cities.created.harvestLater':
        'Les images historiques de la zone seront recherchées une fois que vous aurez configuré USGS (Configuration).',
    'adminContent.cities.created.next': 'Que faire ensuite ?',
    'adminContent.cities.created.photos': 'Ajouter des photos',
    'adminContent.cities.created.places': 'Ajoutez des lieux.',
    'adminContent.cities.created.imagery': 'Consultez les images d’époque.',
    'adminContent.cities.created.siteLater': 'Une fois publiée, les visiteurs pourront accéder à la carte à cette adresse :',
    'adminContent.cities.created.exportInstead':
        'Exporter la ville dans les paramètres crée également une copie pour tout hébergement statique.',
    'adminContent.cities.newTab': "(s'ouvre dans un nouvel onglet)",
    'adminContent.budgets.title': 'Le budget de la ville',
    'adminContent.budgets.intro':
        'La part du budget du projet allouée à la ville ; les limites globales du projet s’appliquent à toutes les villes.',
    'adminContent.budgets.computeUnits': 'Unités de calcul Mapbox par mois',
    'adminContent.budgets.rasterJobs': 'Nombre de traitements d’images par jour.',
    'adminContent.budgets.aiRequests': 'Traductions automatiques par mois.',
    'adminContent.budgets.geocodeCells': 'Suggestions de titres par jour.',
    'adminContent.budgets.exports': 'Exports par jour',
    'adminContent.budgets.projectCapsOnly':
        'Il n’a pas encore de limites propres : seules les limites du projet s’appliquent. Un champ vide conserve la limite.',
    'adminContent.budgets.usedNoLimit': 'Utilisé jusqu’à présent pendant cette période : {used}',
    'adminContent.budgets.used': 'Utilisé jusqu’à présent pour cette période : {used} sur {limit}',
    'adminContent.budgets.saved': 'Le budget de la ville a été enregistré.',
    'adminContent.budgets.invalid': 'Chaque limite est un nombre compris entre 0 et le plafond du projet.',
    'adminContent.budgets.ownerOnly': 'Seul le propriétaire du projet peut modifier les budgets des villes.',
};
