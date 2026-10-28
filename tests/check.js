#!/usr/bin/env node
/**
 * Checks the card's contingency and call-building logic in Node. No framework, no jsdom: the
 * few browser globals the file touches when it loads are shimmed below (the card's element
 * classes are defined but never constructed here).
 *
 *   node tests/check.js
 */
'use strict';

const path = require( 'path' );
const assert = require( 'assert' );

// What the file needs at load time to define its elements and register with the card picker.
global.HTMLElement = class {};
global.customElements = { _defs: {}, get( n ) { return this._defs[ n ]; }, define( n, c ) { this._defs[ n ] = c; } };
global.window = {};
global.document = { createElement() { return {}; } };

const logic = require( path.join( __dirname, '..', 'dist', 'huckleberry-diaper-card.js' ) );
const { sizeRowsFor, canLog, huckleberryCall, scriptCall, placesFrom, defaultPlace, errorText, relative } = logic;

let passed = 0;
function test( name, fn ) {
	try {
		fn();
		passed += 1;
		console.log( '  ok   ' + name );
	} catch ( err ) {
		console.log( '  FAIL ' + name );
		console.log( String( err && err.stack || err ).split( '\n' ).map( ( l ) => '       ' + l ).join( '\n' ) );
		process.exitCode = 1;
	}
}

console.log( 'Registration' );
test( 'defines both elements and registers with the card picker', () => {
	assert.ok( customElements.get( 'huckleberry-diaper-card' ) );
	assert.ok( customElements.get( 'huckleberry-diaper-card-editor' ) );
	assert.strictEqual( window.customCards.length, 1 );
	assert.strictEqual( window.customCards[ 0 ].type, 'huckleberry-diaper-card' );
} );

console.log( 'Size rows by kind' );
test( 'pee and poo show one row, mixed two, dry none, nothing chosen none', () => {
	assert.deepStrictEqual( sizeRowsFor( 'pee' ), [ 'pee' ] );
	assert.deepStrictEqual( sizeRowsFor( 'poo' ), [ 'poo' ] );
	assert.deepStrictEqual( sizeRowsFor( 'mixed' ), [ 'pee', 'poo' ] );
	assert.deepStrictEqual( sizeRowsFor( 'dry' ), [] );
	assert.deepStrictEqual( sizeRowsFor( '' ), [] );
	assert.deepStrictEqual( sizeRowsFor( 'bottle' ), [] );
} );

console.log( 'When Log is enabled' );
test( 'needs a kind', () => {
	assert.strictEqual( canLog( '', {} ), false );
	assert.strictEqual( canLog( undefined, { pee: 'small' } ), false );
} );
test( 'pee or poo needs its one size', () => {
	assert.strictEqual( canLog( 'pee', {} ), false );
	assert.strictEqual( canLog( 'pee', { poo: 'small' } ), false );
	assert.strictEqual( canLog( 'pee', { pee: 'small' } ), true );
	assert.strictEqual( canLog( 'poo', { poo: 'large' } ), true );
} );
test( 'mixed needs both sizes', () => {
	assert.strictEqual( canLog( 'mixed', { pee: 'small' } ), false );
	assert.strictEqual( canLog( 'mixed', { poo: 'small' } ), false );
	assert.strictEqual( canLog( 'mixed', { pee: 'medium', poo: 'large' } ), true );
} );
test( 'dry needs no size', () => {
	assert.strictEqual( canLog( 'dry', {} ), true );
} );

console.log( 'The Huckleberry call' );
test( 'pee: log_diaper_pee with pee_amount, sizes in Huckleberry\'s words', () => {
	assert.deepStrictEqual( huckleberryCall( 'pee', { pee: 'small' }, '', 'dev1' ), {
		domain: 'huckleberry', service: 'log_diaper_pee', data: { device_id: 'dev1', pee_amount: 'little' },
	} );
	assert.strictEqual( huckleberryCall( 'pee', { pee: 'medium' }, '', 'd' ).data.pee_amount, 'medium' );
	assert.strictEqual( huckleberryCall( 'pee', { pee: 'large' }, '', 'd' ).data.pee_amount, 'big' );
} );
test( 'poo: log_diaper_poo with poo_amount only', () => {
	const c = huckleberryCall( 'poo', { poo: 'large', pee: 'small' }, '', 'd' );
	assert.strictEqual( c.service, 'log_diaper_poo' );
	assert.deepStrictEqual( c.data, { device_id: 'd', poo_amount: 'big' } );
} );
test( 'mixed: log_diaper_both with both amounts', () => {
	const c = huckleberryCall( 'mixed', { pee: 'small', poo: 'medium' }, '', 'd' );
	assert.strictEqual( c.service, 'log_diaper_both' );
	assert.deepStrictEqual( c.data, { device_id: 'd', pee_amount: 'little', poo_amount: 'medium' } );
} );
test( 'dry: log_diaper_dry with no amounts even if sizes linger', () => {
	const c = huckleberryCall( 'dry', { pee: 'small' }, '', 'd' );
	assert.strictEqual( c.service, 'log_diaper_dry' );
	assert.deepStrictEqual( c.data, { device_id: 'd' } );
} );
test( 'notes only when typed (trimmed)', () => {
	assert.strictEqual( huckleberryCall( 'dry', {}, '   ', 'd' ).data.notes, undefined );
	assert.strictEqual( huckleberryCall( 'dry', {}, '  rash cream ', 'd' ).data.notes, 'rash cream' );
} );
test( 'diaper_rash only when ticked, for every kind', () => {
	assert.strictEqual( huckleberryCall( 'pee', { pee: 'small' }, '', 'd', false ).data.diaper_rash, undefined );
	assert.strictEqual( huckleberryCall( 'pee', { pee: 'small' }, '', 'd', true ).data.diaper_rash, true );
	assert.deepStrictEqual( huckleberryCall( 'dry', {}, 'cream', 'd', true ).data, { device_id: 'd', diaper_rash: true, notes: 'cream' } );
	assert.strictEqual( huckleberryCall( 'mixed', { pee: 'small', poo: 'small' }, '', 'd', true ).data.diaper_rash, true );
} );
test( 'an unknown kind is refused', () => {
	assert.throws( () => huckleberryCall( 'nap', {}, '', 'd' ), /kind/ );
} );

console.log( 'The script call' );
test( 'mixed becomes kind both, amounts only when chosen, no device id', () => {
	assert.deepStrictEqual( scriptCall( 'script.log_a_diaper_change_in_huckleberry', 'mixed', { pee: 'large', poo: 'small' }, 'x' ), {
		domain: 'script', service: 'log_a_diaper_change_in_huckleberry',
		data: { kind: 'both', pee_amount: 'big', poo_amount: 'little', notes: 'x' },
	} );
	assert.deepStrictEqual( scriptCall( 'diaper_stub', 'dry', {}, '' ).data, { kind: 'dry' } );
	assert.deepStrictEqual( scriptCall( 'diaper_stub', 'dry', {}, '', true ).data, { kind: 'dry', diaper_rash: true } );
	assert.strictEqual( scriptCall( 'diaper_stub', 'poo', { poo: 'small' }, '', false ).data.diaper_rash, undefined );
	assert.strictEqual( scriptCall( 'diaper_stub', 'dry', {}, '' ).domain, 'script' );
} );

console.log( 'Places from Home Gnome' );
const answer = {
	row: { id: 11 },
	item: {
		id: 5,
		entries: [
			{ id: 12, quantity: 6, location: 21, location_path: 'Upstairs › Nursery › Diaper Bag', variant: '1' },
			{ id: 11, quantity: 32, location: 20, location_path: 'Upstairs › Nursery › Changing Table › Shelf', variant: '1' },
			{ id: 99, quantity: 0, location: 5, location_path: 'Basement', variant: 'N' },
			{ id: 98, quantity: 3, location: 6, location_path: 'Lost', variant: 'N', missing: true },
		],
	},
};
test( 'one place per entry with something in it, labelled by the last path segment', () => {
	const places = placesFrom( answer );
	assert.deepStrictEqual( places.map( ( p ) => [ p.id, p.label, p.quantity, p.location ] ), [
		[ 12, 'Diaper Bag', 6, 21 ],
		[ 11, 'Shelf', 32, 20 ],
	] );
} );
test( 'takes GET items/{id}\'s shape too, and nothing from junk', () => {
	assert.strictEqual( placesFrom( answer.item ).length, 2 );
	assert.deepStrictEqual( placesFrom( null ), [] );
	assert.deepStrictEqual( placesFrom( { item: {} } ), [] );
} );
test( 'the default place: by location id, by name, by path text, by entry id, else the first', () => {
	const places = placesFrom( answer );
	assert.strictEqual( defaultPlace( places, { default_location_id: 20 } ), '11' );
	assert.strictEqual( defaultPlace( places, { default_location: 'shelf' } ), '11' );
	assert.strictEqual( defaultPlace( places, { default_location: 'Changing Table' } ), '11' );
	assert.strictEqual( defaultPlace( places, { diaper_entry_id: 11 } ), '11' );
	assert.strictEqual( defaultPlace( places, { diaper_entry_id: 11, default_location: 'Diaper Bag' } ), '12' );
	assert.strictEqual( defaultPlace( places, {} ), '12' );
	assert.strictEqual( defaultPlace( [], { diaper_entry_id: 11 } ), '' );
} );

console.log( 'Words for errors' );
test( 'reads HA\'s service errors and the proxy\'s API errors', () => {
	assert.strictEqual( errorText( { code: 'service_validation_error', message: 'There is no entry 7.' }, 'x' ), 'There is no entry 7.' );
	assert.strictEqual( errorText( { status_code: 403, body: { code: 'home_gnome_not_linked', message: 'Not linked.' } }, 'x' ), 'Not linked.' );
	assert.strictEqual( errorText( new Error( 'boom' ), 'x' ), 'boom' );
	assert.strictEqual( errorText( null, 'fallback' ), 'fallback' );
} );
test( 'relative times', () => {
	const now = Date.parse( '2026-10-27T12:00:00Z' );
	assert.strictEqual( relative( '2026-10-27T11:59:40Z', now ), 'just now' );
	assert.strictEqual( relative( '2026-10-27T11:45:00Z', now ), '15 min ago' );
	assert.strictEqual( relative( '2026-10-27T09:30:00Z', now ), '2 h 30 min ago' );
	assert.strictEqual( relative( '2026-10-25T09:30:00Z', now ), '2 days ago' );
	assert.strictEqual( relative( 'nonsense', now ), '' );
} );

console.log( '' );
console.log( process.exitCode ? 'Some checks failed.' : passed + ' checks passed.' );
