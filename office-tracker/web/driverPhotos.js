/**
 * Headshots from the Bellingham Public Schools transportation staff page.
 * A name with no portrait, including a directory silhouette, is omitted.
 */

/** @type {Record<string, string>} */
const DRIVER_PHOTOS = {
  'lauren-adcox': 'lauren-adcox.jpg',
  'samiullah-azizi': 'samiullah-azizi.jpg',
  'david-balle': 'david-balle.jpg',
  'juan-banuelos': 'juan-banuelos.jpg',
  'robert-blakeslee': 'robert-blakeslee.jpg',
  'brian-boatman': 'brian-boatman.jpg',
  'loriena-bobb': 'loriena-bobb.jpg',
  'ricardo-broberg': 'ricardo-broberg.jpg',
  'colyn-broglie': 'colyn-broglie.jpg',
  'brennan-brown': 'brennan-brown.jpg',
  'terri-cruikshank': 'terri-cruikshank.jpg',
  'jamie-cullop': 'jamie-cullop.jpg',
  'danna-daily': 'danna-daily.jpg',
  'christian-danielson': 'christian-danielson.jpg',
  'lisa-degraaff': 'lisa-degraaff.jpg',
  'johanna-devries': 'johanna-devries.jpg',
  'stacy-frost': 'stacy-frost.jpg',
  'constance-garcia': 'constance-garcia.jpg',
  'eduardo-garcia': 'eduardo-garcia.jpg',
  'bonnie-glispy': 'bonnie-glispy.jpg',
  'drew-graham': 'drew-graham.jpg',
  'aaron-hakeman': 'aaron-hakeman.jpg',
  'rachel-hrutfiord': 'rachel-hrutfiord.jpg',
  'charanjit-hundal': 'charanjit-hundal.jpg',
  'billa-inderjit': 'billa-inderjit.jpg',
  'michael-ingham': 'michael-ingham.jpg',
  'karen-james': 'karen-james.jpg',
  'dennis-jensen': 'dennis-jensen.jpg',
  'ahmad-kakar': 'ahmad-kakar.jpg',
  'iqbal-kaur': 'iqbal-kaur.jpg',
  'paul-krenz': 'paul-krenz.jpg',
  'james-kuhlman': 'james-kuhlman.jpg',
  'john-kwesele': 'john-kwesele.jpg',
  'dechelle-lagares': 'dechelle-lagares.jpg',
  'charlie-lane': 'charlie-lane.jpg',
  'tina-lane': 'tina-lane.jpg',
  'jeremy-larsen': 'jeremy-larsen.jpg',
  'nick-levin': 'nick-levin.jpg',
  'tonia-mark': 'tonia-mark.jpg',
  'ford-martin': 'ford-martin.jpg',
  'sheila-mcauley': 'sheila-mcauley.jpg',
  'heather-mcdermott': 'heather-mcdermott.jpg',
  'masoud-meskinimood': 'masoud-meskinimood.jpg',
  'toni-miller': 'toni-miller.jpg',
  'angela-occhipinti': 'angela-occhipinti.jpg',
  'marjorie-ortega': 'marjorie-ortega.jpg',
  'levi-osborne': 'levi-osborne.jpg',
  'athena-panagos': 'athena-panagos.jpg',
  'rickard-persson': 'rickard-persson.jpg',
  'matthew-peterson': 'matthew-peterson.jpg',
  'darcie-poth': 'darcie-poth.jpg',
  'jaycob-powell': 'jaycob-powell.jpg',
  'natalia-rodriguez-aranzasti': 'natalia-rodriguez-aranzasti.jpg',
  'raul-rojas': 'raul-rojas.jpg',
  'darryl-rose': 'darryl-rose.jpg',
  'julie-sampson': 'julie-sampson.jpg',
  'cody-shurtz': 'cody-shurtz.jpg',
  'mukhtiar-singh': 'mukhtiar-singh.jpg',
  'zachariah-smalley': 'zachariah-smalley.jpg',
  'david-smith': 'david-smith.jpg',
  'moana-smithson': 'moana-smithson.jpg',
  'rhys-smoker': 'rhys-smoker.jpg',
  'cydney-tanner': 'cydney-tanner.jpg',
  'graham-thomas': 'graham-thomas.jpg',
  'rae-anne-thon': 'rae-anne-thon.jpg',
  'tammy-trapp': 'tammy-trapp.jpg',
  'joshua-triplett': 'joshua-triplett.jpg',
  'scott-tulk': 'scott-tulk.jpg',
  'david-vanderyacht': 'david-vanderyacht.jpg',
  'rebecca-vanderyacht': 'rebecca-vanderyacht.jpg',
  'aspi-variava': 'aspi-variava.jpg',
  'mark-wallace': 'mark-wallace.jpg',
  'jessika-west': 'jessika-west.jpg',
  'shemeca-woodfrinch': 'shemeca-woodfrinch.jpg',
  'scott-wright': 'scott-wright.jpg',
};

/**
 * Portrait for a driver on the PIN screen. Blank when this name has no photo.
 * @param {string} name
 */
export function driverPhotoSrc(name) {
  const key = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const file = key ? DRIVER_PHOTOS[key] : '';
  return file ? `driver-photos/${file}` : '';
}

/** @returns {string[]} */
export function driverPhotoPaths() {
  return Object.values(DRIVER_PHOTOS).map((file) => `driver-photos/${file}`);
}
