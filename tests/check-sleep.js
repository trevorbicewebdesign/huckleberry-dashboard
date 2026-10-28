#!/usr/bin/env node
/**
 * Checks the sleep card's sensor reading, version detection and call building in Node. No
 * framework, no jsdom: the few browser globals the file touches when it loads are shimmed
 * below (the card's element classes are defined but never constructed here).
 *
 *   node tests/check-sleep.js
 */
'use strict';

const path = require( 'path' );
const assert = require( 'assert' );

global.HTMLElement = class {};
global.customElements = { _defs: {}, get( n ) { return this._defs[ n ]; }, define( n, c ) { this._defs[ n ] = c; } };
global.window = {};
global.document = { createElement() { return {}; } };

const L = require( path.join( __dirname, '..', 'dist', 'huckleberry-sleep-card.js' ) );

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
	assert.ok( customElements.get( 'huckleberry-sleep-card' ) );
	assert.ok( customElements.get( 'huckleberry-sleep-card-editor' ) );
	assert.ok( window.customCards.some( ( c ) => c.type === 'huckleberry-sleep-card' ) );
} );

console.log( 'The sleep sensor' );
const T = ( s ) => Date.parse( s );
test( 'active: current_start, elapsed to now', () => {
	const s = L.sleepFrom( { state: 'active', attributes: { current_start: '2026-10-27T12:00:00+00:00', previous_start: '2026-10-27T08:00:00+00:00', previous_duration: 'PT1H5M' } } );
	assert.strictEqual( s.status, 'active' );
	assert.strictEqual( s.start, T( '2026-10-27T12:00:00Z' ) );
	assert.ok( Number.isNaN( s.end ) );
	assert.strictEqual( s.previousStart, T( '2026-10-27T08:00:00Z' ) );
	assert.strictEqual( s.previousDuration, 65 * 60000 );
	assert.strictEqual( L.elapsed( s, T( '2026-10-27T12:23:00Z' ) ), 23 * 60000 );
} );
test( 'paused: elapsed stops at current_end', () => {
	const s = L.sleepFrom( { state: 'paused', attributes: { current_start: '2026-10-27T12:00:00+00:00', current_end: '2026-10-27T12:30:00+00:00' } } );
	assert.strictEqual( s.status, 'paused' );
	assert.strictEqual( L.elapsed( s, T( '2026-10-27T13:00:00Z' ) ), 30 * 60000 );
} );
test( 'none / unknown / missing', () => {
	assert.strictEqual( L.sleepFrom( { state: 'none', attributes: {} } ).status, 'none' );
	assert.strictEqual( L.sleepFrom( { state: 'unavailable', attributes: {} } ).status, 'unknown' );
	assert.strictEqual( L.sleepFrom( undefined ).status, 'unknown' );
	assert.ok( Number.isNaN( L.elapsed( L.sleepFrom( { state: 'none', attributes: {} } ) ) ) );
} );
test( 'durations: ISO 8601, clock text, seconds', () => {
	assert.strictEqual( L.parseDuration( 'PT1H23M' ), 83 * 60000 );
	assert.strictEqual( L.parseDuration( 'PT45S' ), 45000 );
	assert.strictEqual( L.parseDuration( 'P1DT2H' ), 26 * 3600000 );
	assert.strictEqual( L.parseDuration( '1:23:05' ), ( 83 * 60 + 5 ) * 1000 );
	assert.strictEqual( L.parseDuration( 90 ), 90000 );
	assert.ok( Number.isNaN( L.parseDuration( 'soon' ) ) );
	assert.strictEqual( L.durationText( 83 * 60000 ), '1 h 23 min' );
	assert.strictEqual( L.durationText( 2 * 3600000 ), '2 h' );
	assert.strictEqual( L.durationText( 45 * 60000 ), '45 min' );
	assert.strictEqual( L.durationText( 40000 ), '40 s' );
} );

console.log( 'Does the integration take time overrides (0.5.6)?' );
test( 'from the action descriptions: start_sleep.start_time and log_sleep', () => {
	assert.strictEqual( L.supportsTimes( { huckleberry: { start_sleep: { fields: { device_id: {}, start_time: {} } }, log_sleep: { fields: {} }, complete_sleep: {} } } ), true );
	assert.strictEqual( L.supportsTimes( { huckleberry: { start_sleep: { fields: { device_id: {} } }, complete_sleep: {} } } ), false );
	assert.strictEqual( L.supportsTimes( {} ), false );
	assert.strictEqual( L.supportsTimes( undefined ), false );
} );
test( 'integration_version wins: 0.5.6 and later yes, 0.5.5 no', () => {
	assert.strictEqual( L.supportsTimes( {}, '0.5.6' ), true );
	assert.strictEqual( L.supportsTimes( {}, 'v0.5.7-beta.20261025.11' ), true );
	assert.strictEqual( L.supportsTimes( {}, '0.6.0' ), true );
	assert.strictEqual( L.supportsTimes( { huckleberry: { start_sleep: { fields: { start_time: {} } }, log_sleep: {} } }, '0.5.5' ), false );
	assert.strictEqual( L.compareVersions( '0.5.10', '0.5.6' ), 1 );
	assert.strictEqual( L.compareVersions( '0.5.6', '0.5.6' ), 0 );
} );
test( 'whether the sleep actions exist at all', () => {
	assert.strictEqual( L.hasSleepActions( { huckleberry: { start_sleep: {}, complete_sleep: {} } } ), true );
	assert.strictEqual( L.hasSleepActions( { huckleberry: { log_bottle: {} } } ), false );
} );

console.log( 'The calls' );
test( 'start / pause / resume / cancel / complete on the device', () => {
	assert.deepStrictEqual( L.startCall( 'dev1' ), { domain: 'huckleberry', service: 'start_sleep', data: { device_id: 'dev1' } } );
	assert.deepStrictEqual( L.sleepCall( 'pause_sleep', 'dev1' ), { domain: 'huckleberry', service: 'pause_sleep', data: { device_id: 'dev1' } } );
	assert.deepStrictEqual( L.sleepCall( 'complete_sleep', 'dev1' ).service, 'complete_sleep' );
	assert.throws( () => L.sleepCall( 'start_sleep', undefined ), /device/ );
} );
test( 'a corrected start: start_sleep with start_time carrying the browser\'s offset, never in the future', () => {
	const now = T( '2026-10-27T20:30:00Z' );
	const call = L.startCall( 'dev1', now - 25 * 60000, now );
	assert.strictEqual( call.service, 'start_sleep' );
	assert.strictEqual( Date.parse( call.data.start_time ), now - 25 * 60000 );
	assert.ok( /[+-]\d{2}:\d{2}$/.test( call.data.start_time ) );
	assert.throws( () => L.startCall( 'dev1', now + 10 * 60000, now ), /future/ );
	assert.throws( () => L.startCall( 'dev1', NaN, now ), /start time/ );
} );
test( 'log_sleep: start before end, neither in the future, notes when typed', () => {
	const now = T( '2026-10-27T20:30:00Z' );
	const call = L.logSleepCall( 'dev1', now - 3 * 3600000, now - 2 * 3600000, ' nap in the car ', now );
	assert.strictEqual( call.service, 'log_sleep' );
	assert.strictEqual( Date.parse( call.data.start_time ), now - 3 * 3600000 );
	assert.strictEqual( Date.parse( call.data.end_time ), now - 2 * 3600000 );
	assert.strictEqual( call.data.notes, 'nap in the car' );
	assert.strictEqual( L.logSleepCall( 'dev1', now - 3600000, now - 60000, '', now ).data.notes, undefined );
	assert.throws( () => L.logSleepCall( 'dev1', now - 3600000, now - 3600000, '', now ), /after the start/ );
	assert.throws( () => L.logSleepCall( 'dev1', now - 3600000, now + 3600000, '', now ), /future/ );
	assert.throws( () => L.logSleepCall( 'dev1', NaN, now, '', now ), /Pick/ );
} );

console.log( 'Time inputs' );
test( 'HH:MM on the start\'s day; a time after now means yesterday', () => {
	const start = new Date( 2026, 9, 27, 13, 5 ).getTime();
	const now = new Date( 2026, 9, 27, 14, 0 ).getTime();
	assert.strictEqual( L.timeValue( start ), '13:05' );
	assert.strictEqual( L.timeOnDay( '12:40', start, now ), new Date( 2026, 9, 27, 12, 40 ).getTime() );
	assert.strictEqual( L.timeOnDay( '23:30', start, now ), new Date( 2026, 9, 26, 23, 30 ).getTime() );
	assert.ok( Number.isNaN( L.timeOnDay( '', start, now ) ) );
} );
test( 'datetime-local values round-trip as local time', () => {
	const t = new Date( 2026, 9, 27, 13, 5 ).getTime();
	assert.strictEqual( L.datetimeValue( t ), '2026-10-27T13:05' );
	assert.strictEqual( L.parseDatetimeValue( '2026-10-27T13:05' ), t );
	assert.ok( Number.isNaN( L.parseDatetimeValue( 'nope' ) ) );
} );

console.log( '' );
console.log( process.exitCode ? 'Some checks failed.' : passed + ' checks passed.' );
