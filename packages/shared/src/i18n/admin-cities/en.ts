import type { AdminCitiesKey } from './ro.js';

/**
 * English texts of the admin's M5 cities: the New city flow, its done screen and a city's budgets.
 * Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error.
 */
export const en: Readonly<Record<AdminCitiesKey, string>> = {
    // [section cities] owner: multi-city; keys adminContent.cities.*
    'adminContent.cities.new.title': 'New city',
    'adminContent.cities.new.intro': 'A name and the area on the map: the rest fills itself in and changes any time in Settings.',
    'adminContent.cities.new.nameRo': 'Name in Romanian',
    'adminContent.cities.new.nameEn': 'Name in English (optional)',
    'adminContent.cities.new.id': 'Id',
    'adminContent.cities.new.idHelp': 'Lower-case letters, digits and hyphens; it appears in addresses: /{cityId}/.',
    'adminContent.cities.new.idInvalid': 'An id has 2 to 32 lower-case letters, digits or hyphens and is no reserved word (like engine).',
    'adminContent.cities.new.area': 'The city’s area',
    'adminContent.cities.new.areaHelp': 'Drag a rectangle over the city on the map.',
    'adminContent.cities.new.located': 'Found on OpenStreetMap: {place}. Adjust the rectangle if needed.',
    'adminContent.cities.new.edgesIncomplete': 'Fill in all four edges to draw the rectangle.',
    'adminContent.cities.new.areaBounds': 'West must be less than east, and south less than north.',
    'adminContent.cities.new.areaTooSmall': 'The area is too small: drag a larger rectangle.',
    'adminContent.cities.new.areaTooBig': 'The area is too large: at most 2 degrees on each side.',
    'adminContent.cities.new.moveMap': 'Move the map',
    'adminContent.cities.new.drawArea': 'Draw the area',
    'adminContent.cities.new.areaLimits': 'Each side {min} to {max} degrees: drag from corner to corner, or click both corners.',
    'adminContent.cities.new.create': 'Create the city',
    'adminContent.cities.new.creating': 'Creating the city…',
    'adminContent.cities.created.title': '{city} was created',
    'adminContent.cities.created.unpublished': 'The city is not public yet: publish it from Settings when it is ready.',
    'adminContent.cities.created.harvest': 'Looking for historical imagery of the area: the first appear within minutes.',
    'adminContent.cities.created.harvestLater': 'Historical imagery of the area is looked for once USGS is set up (Setup).',
    'adminContent.cities.created.next': 'What comes next',
    'adminContent.cities.created.photos': 'Add photos',
    'adminContent.cities.created.places': 'Draw places',
    'adminContent.cities.created.imagery': 'See the historical imagery',
    'adminContent.cities.created.siteLater': 'Once it is published, visitors find its map at this address:',
    'adminContent.cities.created.exportInstead': 'Export the city in Settings also makes a copy for any static host.',
    'adminContent.cities.newTab': '(opens in a new tab)',
    // [end cities]
    // [section budgets] owner: multi-city; keys adminContent.budgets.*
    'adminContent.budgets.title': 'The city’s budget',
    'adminContent.budgets.intro': 'The city’s share of the project’s budgets; the project’s own limits still hold for every city.',
    'adminContent.budgets.computeUnits': 'Mapbox compute units a month',
    'adminContent.budgets.rasterJobs': 'Imagery processing jobs a day',
    'adminContent.budgets.aiRequests': 'Automatic translations a month',
    'adminContent.budgets.geocodeCells': 'Title suggestions a day',
    'adminContent.budgets.exports': 'Exports a day',
    'adminContent.budgets.projectCapsOnly': 'No limits of its own yet: the project’s caps alone hold it. An empty field stays at the cap.',
    'adminContent.budgets.usedNoLimit': 'Used so far in this period: {used}',
    'adminContent.budgets.used': 'Used so far in this period: {used} of {limit}',
    'adminContent.budgets.saved': 'The city’s budget was saved.',
    'adminContent.budgets.invalid': 'Each limit is a number from 0 up to the project’s own cap.',
    'adminContent.budgets.ownerOnly': 'Only the project’s owner changes the cities’ budgets.',
    // [end budgets]
};
