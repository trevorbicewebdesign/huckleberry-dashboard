/**
 * Huckleberry dashboard — the one resource that loads every card in this folder.
 *
 * HACS registers this file as the dashboard resource
 * (/hacsfiles/huckleberry-dashboard/huckleberry-dashboard.js) and downloads the rest of dist/
 * beside it, so each card is imported relative to this file's own address. A manual install
 * works the same way: copy dist/ to config/www/community/huckleberry-dashboard/ and add this
 * one file as a JavaScript module resource.
 *
 * Each card stays a plain script that registers its own custom element; a card that fails to
 * load is reported in the browser console and leaves the others working.
 */
const CARDS = [
	'huckleberry-diaper-card.js',
	'huckleberry-feeding-card.js',
	'huckleberry-sleep-card.js',
	'huckleberry-recent-card.js',
	'huckleberry-growth-card.js',
];

const base = new URL( '.', import.meta.url );
const version = new URL( import.meta.url ).search; // keeps HACS's ?hacstag=… cache buster on each card

await Promise.all( CARDS.map( ( file ) =>
	import( new URL( file + version, base ).href ).catch( ( err ) => {
		console.error( 'huckleberry-dashboard: could not load ' + file, err );
	} )
) );
