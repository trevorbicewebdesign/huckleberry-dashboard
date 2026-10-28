#!/usr/bin/env node
/**
 * Checks the recent card's history and calendar parsing, merging and grouping in Node. No
 * framework, no jsdom: the few browser globals the file touches when it loads are shimmed
 * below (the card's element classes are defined but never constructed here).
 *
 *   node tests/check-recent.js
 */
'use strict';

const path = require( 'path' );
const assert = require( 'assert' );

global.HTMLElement = class {};
global.customElements = { _defs: {}, get( n ) { return this._defs[ n ]; }, define( n, c ) { this._defs[ n ] = c; } };
global.window = {};
global.document = { createElement() { return {}; } };

const L = require( path.join( __dirname, '..', 'dist', 'huckleberry-recent-card.js' ) );

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
const T = ( s ) => Date.parse( s );

console.log( 'Registration' );
test( 'defines both elements and registers with the card picker', () => {
	assert.ok( customElements.get( 'huckleberry-recent-card' ) );
	assert.ok( customElements.get( 'huckleberry-recent-card-editor' ) );
	assert.ok( window.customCards.some( ( c ) => c.type === 'huckleberry-recent-card' ) );
} );

console.log( 'Entities' );
test( 'from the child slug, with explicit keys winning and none turning one off', () => {
	assert.deepStrictEqual( L.entitiesFrom( { child: 'rose' } ), {
		diaper: 'sensor.rose_diaper', bottle: 'sensor.rose_bottle', solids: 'sensor.rose_solids', sleep: 'sensor.rose_sleep',
		growth: 'sensor.rose_growth', calendar: 'calendar.rose_events',
	} );
	const e = L.entitiesFrom( { child: 'Rose Bud', bottle_entity: 'sensor.feeds', calendar_entity: 'none' } );
	assert.strictEqual( e.diaper, 'sensor.rose_bud_diaper' );
	assert.strictEqual( e.bottle, 'sensor.feeds' );
	assert.strictEqual( e.calendar, '' );
	assert.strictEqual( L.entitiesFrom( { diaper_entity: 'sensor.x' } ).sleep, '' );
} );

console.log( 'The recorder\'s rows' );
test( 'compressed websocket rows and REST rows read alike, attributes carried forward', () => {
	const ws = L.historyRows( [ { s: 'a', a: { x: 1 }, lu: 1793131500 }, { s: 'b', lu: 1793131560.5 } ] );
	assert.deepStrictEqual( ws, [ { state: 'a', attributes: { x: 1 }, updated: 1793131500000 }, { state: 'b', attributes: { x: 1 }, updated: 1793131560500 } ] );
	const rest = L.historyRows( [ { state: 'a', attributes: { x: 2 }, last_updated: '2026-10-27T18:05:00+00:00' } ] );
	assert.deepStrictEqual( rest, [ { state: 'a', attributes: { x: 2 }, updated: T( '2026-10-27T18:05:00Z' ) } ] );
	assert.deepStrictEqual( L.historyRows( null ), [] );
} );
test( 'diaper / bottle / solids / growth: one event per distinct timestamp state, with that row\'s attributes', () => {
	const rows = [
		{ s: '2026-10-26T20:00:00+00:00', a: { type: 'Pee', time: '2026-10-26T20:00:00+00:00' }, lu: 1 },
		{ s: '2026-10-27T08:00:00+00:00', a: { type: 'Both', time: '2026-10-27T08:00:00+00:00' }, lu: 2 },
		{ s: '2026-10-27T08:00:00+00:00', a: { type: 'Both', time: '2026-10-27T08:00:00+00:00' }, lu: 3 },
		{ s: 'unknown', a: {}, lu: 4 },
	];
	const events = L.eventsFromHistory( 'diaper', rows, T( '2026-10-27T00:00:00Z' ) );
	assert.deepStrictEqual( events.map( ( e ) => [ e.kind, e.time, e.type ] ), [ [ 'diaper', T( '2026-10-27T08:00:00Z' ), 'Mixed' ] ] );
	const all = L.eventsFromHistory( 'diaper', rows );
	assert.strictEqual( all.length, 2 );
	const bottles = L.eventsFromHistory( 'bottle', [ { s: '2026-10-27T09:00:00+00:00', a: { amount: 4, units: 'oz', type: 'Breast_Milk' }, lu: 1 } ] );
	assert.deepStrictEqual( bottles, [ { kind: 'bottle', time: T( '2026-10-27T09:00:00Z' ), amount: 4, units: 'oz', type: 'Breast milk' } ] );
	const solids = L.eventsFromHistory( 'solids', [ { s: '2026-10-27T11:00:00+00:00', a: { foods: [ 'Banana', 'Rice' ], reaction: 'liked' }, lu: 1 } ] );
	assert.deepStrictEqual( solids[ 0 ].foods, [ 'Banana', 'Rice' ] );
	assert.strictEqual( solids[ 0 ].reaction, 'Liked' );
	const growth = L.eventsFromHistory( 'growth', [ { s: '2026-10-20T10:00:00+00:00', a: { weight: 7.2, weight_unit: 'kg', height: 65.5, height_unit: 'cm', head_circumference: 42, head_unit: 'hcm' }, lu: 1 } ] );
	assert.deepStrictEqual( [ growth[ 0 ].weight, growth[ 0 ].height, growth[ 0 ].head ], [ '7.2 kg', '65.5 cm', '42 cm' ] );
} );
test( 'sleep: each previous_start / previous_duration pair is a finished sleep', () => {
	const rows = [
		{ s: 'none', a: { previous_start: '2026-10-27T01:00:00+00:00', previous_duration: 'PT1H20M' }, lu: 1 },
		{ s: 'active', a: { current_start: '2026-10-27T05:00:00+00:00', previous_start: '2026-10-27T01:00:00+00:00', previous_duration: 'PT1H20M' }, lu: 2 },
		{ s: 'none', a: { previous_start: '2026-10-27T05:00:00+00:00', previous_duration: 'PT45M' }, lu: 3 },
	];
	const events = L.eventsFromHistory( 'sleep', rows );
	assert.deepStrictEqual( events.map( ( e ) => [ e.time, e.duration ] ), [ [ T( '2026-10-27T01:00:00Z' ), 80 * 60000 ], [ T( '2026-10-27T05:00:00Z' ), 45 * 60000 ] ] );
} );
test( 'the running sleep from the live sensor', () => {
	const ev = L.ongoingSleep( { state: 'active', attributes: { current_start: '2026-10-27T05:00:00+00:00' } } );
	assert.strictEqual( ev.kind, 'sleep' );
	assert.strictEqual( ev.ongoing, true );
	assert.strictEqual( ev.time, T( '2026-10-27T05:00:00Z' ) );
	const paused = L.ongoingSleep( { state: 'paused', attributes: { current_start: '2026-10-27T05:00:00+00:00', current_end: '2026-10-27T05:30:00+00:00' } } );
	assert.strictEqual( paused.duration, 30 * 60000 );
	assert.strictEqual( L.ongoingSleep( { state: 'none', attributes: {} } ), null );
} );

console.log( 'The calendar\'s events (as the integration writes them)' );
const cal = ( summary, description, start, end ) => L.eventFromCalendar( { summary, description, start: { dateTime: start }, end: { dateTime: end || start } } );
test( 'diapers with kind, sizes and rash', () => {
	const ev = cal( '💧💩 Diaper (Both)', 'Diaper: both\nPee amount: medium\nPoo amount: big\nDiaper rash: yes\nNotes: cream', '2026-09-30T08:00:00-07:00' );
	assert.deepStrictEqual( ev, { kind: 'diaper', time: T( '2026-09-30T08:00:00-07:00' ), type: 'Mixed', pee: 'medium', poo: 'large', rash: true, note: 'cream' } );
	assert.strictEqual( L.detailText( ev ), 'Mixed · pee medium, poo large · rash' );
	assert.strictEqual( L.detailText( cal( '💧 Diaper (Pee)', 'Diaper: pee\nPee amount: little', '2026-09-30T08:00:00Z' ) ), 'Pee · small' );
	assert.strictEqual( L.detailText( cal( '✅ Diaper (Dry)', 'Diaper: dry', '2026-09-30T08:00:00Z' ) ), 'Dry' );
} );
test( 'bottles with amount and type', () => {
	const ev = cal( '🍼 Bottle (4 oz)', 'Bottle feeding: 4 oz\nType: formula', '2026-09-30T09:00:00Z' );
	assert.deepStrictEqual( ev, { kind: 'bottle', time: T( '2026-09-30T09:00:00Z' ), amount: 4, units: 'oz', type: 'Formula', note: '' } );
	assert.strictEqual( L.detailText( ev ), '4 oz formula' );
	assert.strictEqual( L.detailText( cal( '🍼 Bottle', 'Bottle feeding', '2026-09-30T09:00:00Z' ) ), 'Bottle' );
} );
test( 'nursing, solids, sleeps and growth', () => {
	const feed = cal( '🍼 Feed (L:10m R:5m)', 'Feeding - Total: 15 min\nLeft: 10 min\nRight: 5 min', '2026-09-30T10:00:00Z', '2026-09-30T10:15:00Z' );
	assert.strictEqual( feed.kind, 'nursing' );
	assert.strictEqual( L.detailText( feed ), '15 min · L 10 min, R 5 min' );
	const solids = cal( '🥄 Solids (Banana, Rice (2 tbsp))', 'Solid food feeding\nFoods: Banana, Rice (2 tbsp)\nReaction: liked', '2026-09-30T11:00:00Z' );
	assert.deepStrictEqual( solids.foods, [ 'Banana', 'Rice (2 tbsp)' ] );
	assert.strictEqual( L.detailText( solids ), 'Banana, Rice (2 tbsp) · liked' );
	const sleep = cal( '💤 Sleep (1h 20m)', 'Sleep duration: 80 min\nSleep location: Stroller', '2026-09-30T12:00:00Z', '2026-09-30T13:20:00Z' );
	assert.strictEqual( sleep.kind, 'sleep' );
	assert.strictEqual( sleep.duration, 80 * 60000 );
	assert.strictEqual( L.detailText( sleep ), '1 h 20 min' );
	assert.strictEqual( cal( '💤 Sleep (45m)', 'Sleep duration: 45 min 10 sec', '2026-09-30T12:00:00Z' ).duration, ( 45 * 60 + 10 ) * 1000 );
	const growth = cal( '📏 Growth Measurement', 'Growth measurement\nWeight: 7.3 kg\nHeight: 65 cm\nHead: 42 cm', '2026-09-30T14:00:00Z' );
	assert.strictEqual( growth.kind, 'growth' );
	assert.strictEqual( L.detailText( growth ), '7.3 kg · 65 cm · 42 cm' );
} );
test( 'potty, and anything else keeps its summary', () => {
	const potty = cal( '🚽 Potty (Pee, Went potty)', 'Potty: pee\nHow it happened: Went potty', '2026-09-30T15:00:00Z' );
	assert.strictEqual( potty.kind, 'potty' );
	assert.strictEqual( L.detailText( potty ), 'Pee · went potty' );
	const med = cal( '💊 Medication (Vitamin D)', 'Medication: Vitamin D\nAmount: 1 drop', '2026-09-30T16:00:00Z' );
	assert.strictEqual( med.kind, 'other' );
	assert.strictEqual( L.kindLabel( med ), 'Medication' );
	assert.strictEqual( L.detailText( med ), 'Vitamin D' );
	assert.strictEqual( L.eventFromCalendar( { summary: 'x' } ), null );
} );

console.log( 'Merging and grouping' );
test( 'newest first, same kind within a minute is one event, the incoming copy wins', () => {
	const a = { kind: 'bottle', time: T( '2026-10-27T09:00:00Z' ), amount: 4 };
	const b = { kind: 'bottle', time: T( '2026-10-27T09:00:20Z' ), amount: 4, type: 'Formula' };
	const c = { kind: 'diaper', time: T( '2026-10-27T09:00:10Z' ) };
	const d = { kind: 'bottle', time: T( '2026-10-26T09:00:00Z' ) };
	const merged = L.mergeEvents( [ a, d ], [ b, c ] );
	assert.deepStrictEqual( merged.map( ( e ) => [ e.kind, e.time ] ), [ [ 'bottle', b.time ], [ 'diaper', c.time ], [ 'bottle', d.time ] ] );
	assert.strictEqual( merged[ 0 ].type, 'Formula' );
} );
test( 'days: Today, Yesterday, then a short date; newest day first', () => {
	const now = new Date( 2026, 9, 27, 12, 0 ).getTime();
	const events = [
		{ kind: 'bottle', time: new Date( 2026, 9, 25, 9, 0 ).getTime() },
		{ kind: 'diaper', time: new Date( 2026, 9, 27, 8, 0 ).getTime() },
		{ kind: 'sleep', time: new Date( 2026, 9, 26, 23, 30 ).getTime() },
		{ kind: 'diaper', time: new Date( 2026, 9, 27, 10, 0 ).getTime() },
	];
	const groups = L.groupByDay( events, now, 'en-US' );
	assert.deepStrictEqual( groups.map( ( g ) => [ g.label, g.events.length ] ), [ [ 'Today', 2 ], [ 'Yesterday', 1 ], [ 'Sun, Oct 25', 1 ] ] );
	assert.strictEqual( groups[ 0 ].events[ 0 ].time, new Date( 2026, 9, 27, 10, 0 ).getTime() );
	assert.strictEqual( L.dayLabel( new Date( 2025, 11, 31 ).getTime(), now, 'en-US' ), 'Wed, Dec 31, 2025' );
} );
test( 'durations in words', () => {
	assert.strictEqual( L.durationText( 80 * 60000 ), '1 h 20 min' );
	assert.strictEqual( L.durationText( 45000 ), '45 s' );
	assert.strictEqual( L.parseDuration( '1h 20m' ), 80 * 60000 );
	assert.strictEqual( L.parseDuration( 'PT1H5M' ), 65 * 60000 );
	assert.ok( Number.isNaN( L.parseDuration( 'later' ) ) );
} );

console.log( '' );
console.log( process.exitCode ? 'Some checks failed.' : passed + ' checks passed.' );
