#!/usr/bin/env node
/**
 * Checks the feeding card's helper reading, call building and amount logic in Node. No
 * framework, no jsdom: the few browser globals the file touches when it loads are shimmed
 * below (the card's element classes are defined but never constructed here).
 *
 *   node tests/check-feeding.js
 */
'use strict';

const path = require( 'path' );
const assert = require( 'assert' );

global.HTMLElement = class {};
global.customElements = { _defs: {}, get( n ) { return this._defs[ n ]; }, define( n, c ) { this._defs[ n ] = c; } };
global.window = {};
global.document = { createElement() { return {}; } };

const L = require( path.join( __dirname, '..', 'dist', 'huckleberry-feeding-card.js' ) );

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
	assert.ok( customElements.get( 'huckleberry-feeding-card' ) );
	assert.ok( customElements.get( 'huckleberry-feeding-card-editor' ) );
	assert.ok( window.customCards.some( ( c ) => c.type === 'huckleberry-feeding-card' ) );
} );

console.log( 'Units and amounts' );
test( 'oz by default: 0.5 steps from 4; ml: 10 from 120; config overrides', () => {
	assert.deepStrictEqual( [ L.unitSettings( {} ).id, L.unitSettings( {} ).step, L.unitSettings( {} ).amount ], [ 'oz', 0.5, 4 ] );
	assert.deepStrictEqual( [ L.unitSettings( { units: 'ml' } ).id, L.unitSettings( { units: 'ml' } ).step, L.unitSettings( { units: 'ml' } ).amount ], [ 'ml', 10, 120 ] );
	assert.deepStrictEqual( [ L.unitSettings( { default_amount: 6, step: 1 } ).amount, L.unitSettings( { default_amount: 6, step: 1 } ).step ], [ 6, 1 ] );
} );
test( 'amounts snap to the step and stay within 0 and the unit\'s max', () => {
	const oz = L.unitSettings( {} );
	assert.strictEqual( L.clampAmount( 4.3, oz ), 4.5 );
	assert.strictEqual( L.clampAmount( 4.2, oz ), 4 );
	assert.strictEqual( L.clampAmount( -1, oz ), 0 );
	assert.strictEqual( L.clampAmount( 'x', oz ), 0 );
	assert.strictEqual( L.clampAmount( 999, oz ), 64 );
	assert.strictEqual( L.clampAmount( 123, L.unitSettings( { units: 'ml' } ) ), 120 );
	assert.strictEqual( L.amountText( 4.5 ), '4.5' );
	assert.strictEqual( L.amountText( 4 ), '4' );
} );
test( 'types offered: formula and breast milk by default, config may add Huckleberry\'s others', () => {
	assert.deepStrictEqual( L.typesOffered( {} ).map( ( t ) => t.id ), [ 'formula', 'breast_milk' ] );
	assert.deepStrictEqual( L.typesOffered( { bottle_types: [ 'formula', 'cow_milk', 'juice' ] } ).map( ( t ) => t.id ), [ 'formula', 'cow_milk' ] );
	assert.deepStrictEqual( L.typesOffered( { bottle_types: [ 'nope' ] } ).map( ( t ) => t.id ), [ 'formula', 'breast_milk' ] );
	assert.strictEqual( L.typeLabel( 'breast_milk' ), 'Breast milk' );
} );

console.log( 'The helpers' );
const ids = L.helperIds( 'huckleberry' );
test( 'helper ids from the prefix', () => {
	assert.deepStrictEqual( ids, {
		started: 'input_datetime.huckleberry_bottle_started',
		prepared: 'input_number.huckleberry_bottle_prepared',
		had: 'input_number.huckleberry_bottle_had',
		type: 'input_select.huckleberry_bottle_type',
		note: 'input_text.huckleberry_bottle_note',
	} );
	assert.strictEqual( L.helperIds( 'Nursery 2' ).prepared, 'input_number.nursery_2_bottle_prepared' );
	assert.strictEqual( L.helperIds( '' ).had, 'input_number.huckleberry_bottle_had' );
} );
const states = {
	[ ids.started ]: { state: '2026-10-27 13:05:00', attributes: { timestamp: 1793131500 } },
	[ ids.prepared ]: { state: '4.0' },
	[ ids.had ]: { state: '0.0' },
	[ ids.type ]: { state: 'formula' },
	[ ids.note ]: { state: 'warmed' },
};
test( 'missing helpers are named', () => {
	assert.deepStrictEqual( L.missingHelpers( states, ids ), [] );
	assert.deepStrictEqual( L.missingHelpers( { [ ids.started ]: {} }, ids ), [ ids.prepared, ids.had, ids.type, ids.note ] );
} );
test( 'an open bottle: started from the timestamp attribute, had = prepared until entered', () => {
	const open = L.openBottleFrom( states, ids );
	assert.deepStrictEqual( open, { started: 1793131500000, prepared: 4, had: 4, hadEntered: false, type: 'formula', note: 'warmed' } );
	const entered = L.openBottleFrom( { ...states, [ ids.had ]: { state: '3.5' } }, ids );
	assert.strictEqual( entered.had, 3.5 );
	assert.strictEqual( entered.hadEntered, true );
} );
test( 'no bottle when prepared is 0 or the start is unset', () => {
	assert.strictEqual( L.openBottleFrom( { ...states, [ ids.prepared ]: { state: '0.0' } }, ids ), null );
	assert.strictEqual( L.openBottleFrom( { ...states, [ ids.started ]: { state: 'unknown', attributes: {} } }, ids ), null );
	assert.strictEqual( L.openBottleFrom( { ...states, [ ids.started ]: { state: '1970-01-01 00:00:00', attributes: { timestamp: 0 } } }, ids ), null );
	assert.strictEqual( L.openBottleFrom( {}, ids ), null );
} );
test( 'the start falls back to the state text, and an unknown type becomes other', () => {
	const open = L.openBottleFrom( { ...states, [ ids.started ]: { state: '2026-10-27 13:05:00', attributes: {} }, [ ids.type ]: { state: 'juice' } }, ids );
	assert.strictEqual( open.started, new Date( 2026, 9, 27, 13, 5, 0 ).getTime() );
	assert.strictEqual( open.type, 'other' );
} );
test( 'opening writes the five helpers, closing zeroes prepared and had and clears the note', () => {
	const writes = L.openWrites( ids, { started: 1793131500123, prepared: 4.5, type: 'breast_milk', note: 'x' } );
	assert.deepStrictEqual( writes.map( ( w ) => [ w.domain, w.service, w.data.entity_id ] ), [
		[ 'input_datetime', 'set_datetime', ids.started ], [ 'input_number', 'set_value', ids.prepared ], [ 'input_number', 'set_value', ids.had ],
		[ 'input_select', 'select_option', ids.type ], [ 'input_text', 'set_value', ids.note ],
	] );
	assert.strictEqual( writes[ 0 ].data.timestamp, 1793131500 );
	assert.strictEqual( writes[ 1 ].data.value, 4.5 );
	assert.strictEqual( writes[ 2 ].data.value, 4.5 );
	assert.strictEqual( writes[ 3 ].data.option, 'breast_milk' );
	assert.strictEqual( writes[ 4 ].data.value, 'x' );
	const close = L.closeWrites( ids );
	assert.deepStrictEqual( close.map( ( w ) => [ w.data.entity_id, w.data.value ] ), [ [ ids.prepared, 0 ], [ ids.had, 0 ], [ ids.note, '' ] ] );
} );

console.log( 'The Huckleberry call' );
test( 'log_bottle with the amount had, oz, the type, the start with an offset, notes when typed', () => {
	const open = L.openBottleFrom( { ...states, [ ids.had ]: { state: '3.5' } }, ids );
	const call = L.logBottleCall( open, 'dev1', 'oz' );
	assert.strictEqual( call.domain, 'huckleberry' );
	assert.strictEqual( call.service, 'log_bottle' );
	assert.strictEqual( call.data.device_id, 'dev1' );
	assert.strictEqual( call.data.amount, 3.5 );
	assert.strictEqual( call.data.units, 'oz' );
	assert.strictEqual( call.data.bottle_type, 'formula' );
	assert.strictEqual( call.data.notes, 'warmed' );
	assert.ok( /^2026-10-2\dT\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/.test( call.data.start_time ), call.data.start_time );
	assert.strictEqual( Date.parse( call.data.start_time ), 1793131500000 );
} );
test( 'the prepared amount when nothing was entered; ml; no notes key when blank', () => {
	const open = L.openBottleFrom( { ...states, [ ids.note ]: { state: '  ' } }, ids );
	const call = L.logBottleCall( open, 'd', 'ml' );
	assert.strictEqual( call.data.amount, 4 );
	assert.strictEqual( call.data.units, 'ml' );
	assert.strictEqual( call.data.notes, undefined );
} );
test( 'no open bottle is refused', () => {
	assert.throws( () => L.logBottleCall( null, 'd', 'oz' ), /No bottle/ );
} );

console.log( 'The last bottle' );
test( 'from the sensor\'s state and attributes', () => {
	const last = L.lastBottleFrom( { state: '2026-10-27T18:05:00+00:00', attributes: { time: '2026-10-27T18:05:00+00:00', amount: 4, units: 'oz', type: 'Formula' } } );
	assert.deepStrictEqual( last, { time: Date.parse( '2026-10-27T18:05:00+00:00' ), amount: 4, units: 'oz', type: 'Formula' } );
	assert.strictEqual( L.lastBottleFrom( { state: 'unknown', attributes: {} } ), null );
	assert.strictEqual( L.lastBottleFrom( undefined ), null );
} );
test( 'relative times and errors', () => {
	const now = Date.parse( '2026-10-27T12:00:00Z' );
	assert.strictEqual( L.relative( Date.parse( '2026-10-27T11:45:00Z' ), now ), '15 min ago' );
	assert.strictEqual( L.relative( Date.parse( '2026-10-27T09:30:00Z' ), now ), '2 h 30 min ago' );
	assert.strictEqual( L.errorText( { code: 'service_validation_error', message: 'bad' }, 'x' ), 'bad' );
	assert.strictEqual( L.errorText( null, 'fallback' ), 'fallback' );
} );

console.log( '' );
console.log( process.exitCode ? 'Some checks failed.' : passed + ' checks passed.' );
