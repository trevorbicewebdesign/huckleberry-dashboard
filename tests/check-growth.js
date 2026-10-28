#!/usr/bin/env node
/**
 * Checks the growth card's event parser, unit conversion and WHO LMS percentile math in Node.
 * No framework, no jsdom: the few browser globals the file touches when it loads are shimmed
 * below (the card's element classes are defined but never constructed here).
 *
 *   node tests/check-growth.js
 */
'use strict';

const path = require( 'path' );
const assert = require( 'assert' );

global.HTMLElement = class {};
global.customElements = { _defs: {}, get( n ) { return this._defs[ n ]; }, define( n, c ) { this._defs[ n ] = c; } };
global.window = {};
global.document = { createElement() { return {}; } };

const L = require( path.join( __dirname, '..', 'dist', 'huckleberry-growth-card.js' ) );

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
const near = ( a, b, tol, msg ) => assert.ok( Math.abs( a - b ) <= tol, ( msg || '' ) + ' expected ' + a + ' ≈ ' + b + ' (±' + tol + ')' );

console.log( 'Registration' );
test( 'defines both elements and registers with the card picker', () => {
	assert.ok( customElements.get( 'huckleberry-growth-card' ) );
	assert.ok( customElements.get( 'huckleberry-growth-card-editor' ) );
	assert.ok( window.customCards.some( ( c ) => c.type === 'huckleberry-growth-card' ) );
} );

console.log( 'Measurement text' );
test( 'metric and imperial words, with and without a space', () => {
	assert.deepStrictEqual( L.parseMeasurement( '7.3 kg' ), { value: 7.3, unit: 'kg' } );
	assert.deepStrictEqual( L.parseMeasurement( '65.7cm' ), { value: 65.7, unit: 'cm' } );
	assert.deepStrictEqual( L.parseMeasurement( '12.3 lb' ), { value: 12.3, unit: 'lb' } );
	assert.deepStrictEqual( L.parseMeasurement( '16 in' ), { value: 16, unit: 'in' } );
	assert.deepStrictEqual( L.parseMeasurement( '16.5 inches' ), { value: 16.5, unit: 'in' } );
	assert.deepStrictEqual( L.parseMeasurement( '3,25 kg' ), { value: 3.25, unit: 'kg' } );
	assert.deepStrictEqual( L.parseMeasurement( '42' ), { value: 42, unit: '' } );
	assert.strictEqual( L.parseMeasurement( '' ), null );
	assert.strictEqual( L.parseMeasurement( undefined ), null );
	assert.strictEqual( L.parseMeasurement( 'none' ), null );
} );
test( 'pounds and ounces combine; ounces alone are pounds', () => {
	assert.deepStrictEqual( L.parseMeasurement( '7 lb 4 oz' ), { value: 7.25, unit: 'lb' } );
	assert.deepStrictEqual( L.parseMeasurement( '8 oz' ), { value: 0.5, unit: 'lb' } );
} );
test( 'Huckleberry\'s own unit codes: lbs.oz, ft.in (inches), hcm, hin', () => {
	assert.deepStrictEqual( L.parseMeasurement( '12.3 lbs.oz' ), { value: 12.3, unit: 'lb' } );
	assert.deepStrictEqual( L.parseMeasurement( '24.5 ft.in' ), { value: 24.5, unit: 'in' } );
	assert.deepStrictEqual( L.parseMeasurement( '42 hcm' ), { value: 42, unit: 'cm' } );
	assert.deepStrictEqual( L.parseMeasurement( '16.5 hin' ), { value: 16.5, unit: 'in' } );
} );
test( '"ft" in the calendar text is inches when 10 or more, feet below that', () => {
	assert.deepStrictEqual( L.parseMeasurement( '24 ft' ), { value: 24, unit: 'in' } );
	assert.deepStrictEqual( L.parseMeasurement( '2 ft' ), { value: 24, unit: 'in' } );
	assert.deepStrictEqual( L.parseMeasurement( '2 ft 3 in' ), { value: 27, unit: 'in' } );
} );

console.log( 'Unit conversion' );
test( 'to kg and cm, and back to the display unit', () => {
	near( L.toMetric( { value: 7.25, unit: 'lb' }, 'weight' ), 3.2886, 0.001 );
	near( L.toMetric( { value: 24, unit: 'in' }, 'length' ), 60.96, 0.001 );
	near( L.toMetric( { value: 16, unit: 'in' }, 'head' ), 40.64, 0.001 );
	assert.strictEqual( L.toMetric( { value: 7.3, unit: 'kg' }, 'weight' ), 7.3 );
	assert.strictEqual( L.toMetric( { value: 65.7, unit: '' }, 'length' ), 65.7 );
	near( L.fromMetric( 3.2886, 'lb' ), 7.25, 0.001 );
	near( L.fromMetric( 60.96, 'in' ), 24, 0.001 );
	assert.strictEqual( L.fromMetric( 7.3, 'kg' ), 7.3 );
} );
test( 'display text', () => {
	assert.strictEqual( L.formatValue( 7.297, 'kg' ), '7.3 kg' );
	assert.strictEqual( L.formatValue( 3.25, 'kg' ), '3.25 kg' );
	assert.strictEqual( L.formatValue( 3.2886, 'lb' ), '7 lb 4 oz' );
	assert.strictEqual( L.formatValue( 65.7311, 'cm' ), '65.7 cm' );
	assert.strictEqual( L.formatValue( 60.96, 'in' ), '24 in' );
	assert.strictEqual( L.formatValue( NaN, 'kg' ), '' );
} );

console.log( 'Calendar events' );
const event = ( start, lines, summary ) => ( { start: { dateTime: start }, end: { dateTime: start }, summary: summary === undefined ? '📏 Growth Measurement' : summary, description: lines.join( '\n' ) } );
test( 'the integration\'s wording: Growth measurement / Weight / Height / Head', () => {
	const e = L.parseGrowthEvent( event( '2026-06-22T10:00:00-07:00', [ 'Growth measurement', 'Weight: 5 kg', 'Height: 57 cm', 'Head: 38.1 cm' ] ) );
	assert.strictEqual( e.time, Date.parse( '2026-06-22T10:00:00-07:00' ) );
	assert.deepStrictEqual( e.weight, { value: 5, unit: 'kg' } );
	assert.deepStrictEqual( e.height, { value: 57, unit: 'cm' } );
	assert.deepStrictEqual( e.head, { value: 38.1, unit: 'cm' } );
} );
test( 'imperial wording: lb, "ft" meaning inches, in', () => {
	const e = L.parseGrowthEvent( event( '2026-06-22T10:00:00-07:00', [ 'Growth measurement', 'Weight: 11.5 lb', 'Height: 22.5 ft', 'Head: 15 in' ] ) );
	assert.deepStrictEqual( e.weight, { value: 11.5, unit: 'lb' } );
	assert.deepStrictEqual( e.height, { value: 22.5, unit: 'in' } );
	assert.deepStrictEqual( e.head, { value: 15, unit: 'in' } );
} );
test( 'a measurement with only a weight; an all-day start; "Length" accepted', () => {
	const e = L.parseGrowthEvent( { start: { date: '2026-06-22' }, summary: 'Growth', description: 'Growth measurement\nWeight: 5.1 kg' } );
	assert.strictEqual( e.time, new Date( 2026, 5, 22 ).getTime() );
	assert.strictEqual( e.height, null );
	assert.deepStrictEqual( L.parseGrowthEvent( event( '2026-06-22T10:00:00Z', [ 'Growth measurement', 'Length: 57 cm' ] ) ).height, { value: 57, unit: 'cm' } );
} );
test( 'other events are not measurements', () => {
	assert.strictEqual( L.parseGrowthEvent( event( '2026-06-22T10:00:00Z', [ 'Medication: Vitamin D', 'Amount: 1 ml' ], '💊 Medication (Vitamin D)' ) ), null );
	assert.strictEqual( L.parseGrowthEvent( event( '2026-06-22T10:00:00Z', [ 'Temperature: 37 °C' ], '🌡️ Temperature' ) ), null );
	assert.strictEqual( L.parseGrowthEvent( event( '2026-06-22T10:00:00Z', [ 'Growth measurement' ] ) ), null );
	assert.strictEqual( L.parseGrowthEvent( null ), null );
} );
test( 'the growth sensor\'s latest, in Huckleberry\'s unit codes', () => {
	const e = L.sensorLatest( { state: '2026-10-26T17:00:00+00:00', attributes: { weight: 16.2, weight_unit: 'lbs.oz', height: 26, height_unit: 'ft.in', head_circumference: 16.5, head_unit: 'hin' } } );
	assert.strictEqual( e.time, Date.parse( '2026-10-26T17:00:00+00:00' ) );
	assert.deepStrictEqual( e.weight, { value: 16.2, unit: 'lb' } );
	assert.deepStrictEqual( e.height, { value: 26, unit: 'in' } );
	assert.deepStrictEqual( e.head, { value: 16.5, unit: 'in' } );
	assert.deepStrictEqual( L.sensorLatest( { state: '2026-10-26T17:00:00+00:00', attributes: { weight: 7.35, weight_unit: 'kg' } } ).height, null );
	assert.strictEqual( L.sensorLatest( { state: 'unknown', attributes: {} } ), null );
	assert.strictEqual( L.sensorLatest( { state: 'unavailable', attributes: { weight: 1, weight_unit: 'kg' } } ), null );
} );
test( 'fixture entries: simple shape and HA\'s shape', () => {
	const e = L.parseFixtureEvent( { date: '2026-06-22', weight: '11.5 lb', length: '22.5 in', head: 15 } );
	assert.deepStrictEqual( e.weight, { value: 11.5, unit: 'lb' } );
	assert.deepStrictEqual( e.height, { value: 22.5, unit: 'in' } );
	assert.deepStrictEqual( e.head, { value: 15, unit: '' } );
	assert.ok( L.parseFixtureEvent( event( '2026-06-22T10:00:00Z', [ 'Growth measurement', 'Weight: 5 kg' ] ) ).weight );
	assert.strictEqual( L.parseFixtureEvent( { date: 'nonsense', weight: '5 kg' } ), null );
} );

console.log( 'Series' );
const birth = new Date( 2026, 3, 20 ).getTime();
test( 'three series in time order, in kg and cm, age in WHO months', () => {
	const s = L.seriesFrom( [
		L.parseGrowthEvent( event( '2026-06-22T10:00:00Z', [ 'Growth measurement', 'Weight: 5 kg', 'Height: 57 cm' ] ) ),
		L.parseGrowthEvent( event( '2026-04-20T12:00:00Z', [ 'Growth measurement', 'Weight: 7 lb 1 oz', 'Head: 13.4 in' ] ) ),
	], birth );
	assert.strictEqual( s.weight.length, 2 );
	assert.strictEqual( s.length.length, 1 );
	assert.strictEqual( s.head.length, 1 );
	near( s.weight[ 0 ].metric, 3.2035, 0.001 );
	assert.strictEqual( s.weight[ 0 ].unit, 'lb' );
	assert.strictEqual( s.weight[ 1 ].metric, 5 );
	assert.strictEqual( s.weight[ 1 ].unit, 'kg' );
	near( s.weight[ 1 ].months, ( Date.parse( '2026-06-22T10:00:00Z' ) - birth ) / 86400000 / 30.4375, 1e-9 );
	near( s.head[ 0 ].metric, 34.036, 0.001 );
} );
test( 'the sensor\'s latest joins when newer, and is dropped when it is the last event again', () => {
	const last = event( '2026-10-20T16:00:00Z', [ 'Growth measurement', 'Weight: 7.2 kg' ] );
	const same = L.sensorLatest( { state: '2026-10-20T16:00:30+00:00', attributes: { weight: 7.2, weight_unit: 'kg' } } );
	const newer = L.sensorLatest( { state: '2026-10-26T16:00:00+00:00', attributes: { weight: 7.35, weight_unit: 'kg' } } );
	assert.strictEqual( L.seriesFrom( [ L.parseGrowthEvent( last ), same ], birth ).weight.length, 1 );
	const s = L.seriesFrom( [ L.parseGrowthEvent( last ), newer ], birth ).weight;
	assert.strictEqual( s.length, 2 );
	assert.strictEqual( s[ 1 ].metric, 7.35 );
	assert.deepStrictEqual( L.seriesFrom( [ null, undefined ], birth ), { weight: [], length: [], head: [] } );
} );

console.log( 'WHO LMS percentiles' );
test( 'a 50th-percentile girl at 6 months: 7.3 kg, 65.7 cm, 42.2 cm head', () => {
	near( L.percentileOf( 'weight', 'girl', 6, 7.297 ), 50, 0.05 );
	near( L.percentileOf( 'weight', 'girl', 6, 7.3 ), 50, 0.5 );
	near( L.percentileOf( 'length', 'girl', 6, 65.7 ), 50, 1 );
	near( L.percentileOf( 'head', 'girl', 6, 42.2 ), 50, 1 );
} );
test( 'boys use their own tables: 7.9 kg and 67.6 cm at 6 months', () => {
	near( L.percentileOf( 'weight', 'boy', 6, 7.934 ), 50, 0.05 );
	near( L.percentileOf( 'length', 'boy', 6, 67.6 ), 50, 0.5 );
	assert.ok( L.percentileOf( 'weight', 'girl', 6, 7.934 ) > 60 );
} );
test( 'WHO\'s published SD columns: girls\' birth weight +2 SD is 4.2 kg, −3 SD 2.0 kg; 6-month +2 SD 9.3 kg', () => {
	near( L.valueAtZ( L.lmsAt( 'weight', 'girl', 0 ), 2 ), 4.2, 0.05 );
	near( L.valueAtZ( L.lmsAt( 'weight', 'girl', 0 ), -3 ), 2.0, 0.05 );
	near( L.valueAtZ( L.lmsAt( 'weight', 'girl', 6 ), 2 ), 9.3, 0.05 );
	near( L.valueAtZ( L.lmsAt( 'length', 'girl', 12 ), -2 ), 68.9, 0.05 );
	near( L.valueAtZ( L.lmsAt( 'head', 'boy', 24 ), 2 ), 51.0, 0.1 );
	near( L.zScore( 4.2, L.lmsAt( 'weight', 'girl', 0 ) ), 2, 0.1 );
	near( L.percentileOf( 'weight', 'girl', 0, 4.2 ), 97.7, 0.5 );
} );
test( 'the normal CDF and the curve z-scores', () => {
	near( L.normalCdf( 0 ), 0.5, 1e-7 );
	near( L.normalCdf( 1.0364 ), 0.85, 0.0005 );
	near( L.normalCdf( -1.8808 ), 0.03, 0.0005 );
	near( L.normalCdf( 1.96 ), 0.975, 0.0005 );
	assert.deepStrictEqual( L.PERCENTILES.map( ( p ) => p.p ), [ 3, 15, 50, 85, 97 ] );
} );
test( 'ages between months interpolate; L = 1 means the plain linear formula', () => {
	const a = L.lmsAt( 'weight', 'girl', 6 );
	const b = L.lmsAt( 'weight', 'girl', 7 );
	const mid = L.lmsAt( 'weight', 'girl', 6.5 );
	near( mid[ 1 ], ( a[ 1 ] + b[ 1 ] ) / 2, 1e-9 );
	const lms = L.lmsAt( 'length', 'girl', 6 );
	near( L.zScore( 65.7311 + 2.2664, lms ), 1, 0.001, 'one SD (2.2664 cm) above the median' );
	assert.strictEqual( L.lmsAt( 'weight', 'girl', 25 ), null );
	assert.strictEqual( L.lmsAt( 'weight', 'girl', -1 ), null );
	assert.strictEqual( L.lmsAt( 'weight', 'other', 6 ), null );
	assert.ok( Number.isNaN( L.percentileOf( 'weight', 'girl', 30, 12 ) ) );
	assert.ok( Number.isNaN( L.zScore( 0, L.lmsAt( 'weight', 'girl', 6 ) ) ) );
} );
test( 'all six tables cover months 0 to 24 with the medians rising', () => {
	for ( const measure of [ 'weight', 'length', 'head' ] ) {
		for ( const sex of [ 'girl', 'boy' ] ) {
			const t = L.WHO[ measure ][ sex ];
			assert.strictEqual( t.length, 25, measure + ' ' + sex );
			for ( let i = 1; i < t.length; i++ ) {
				assert.ok( t[ i ][ 1 ] > t[ i - 1 ][ 1 ], measure + ' ' + sex + ' month ' + i );
				assert.ok( t[ i ][ 2 ] > 0 && t[ i ][ 2 ] < 0.2 );
			}
		}
	}
} );

console.log( 'Words and axes' );
test( 'ordinals', () => {
	assert.strictEqual( L.ordinal( 54 ), '54th' );
	assert.strictEqual( L.ordinal( 1.2 ), '1st' );
	assert.strictEqual( L.ordinal( 22 ), '22nd' );
	assert.strictEqual( L.ordinal( 3.4 ), '3rd' );
	assert.strictEqual( L.ordinal( 11 ), '11th' );
	assert.strictEqual( L.ordinal( 12 ), '12th' );
	assert.strictEqual( L.ordinal( 13 ), '13th' );
	assert.strictEqual( L.ordinal( 0.3 ), '<1st' );
	assert.strictEqual( L.ordinal( 99.6 ), '>99th' );
	assert.strictEqual( L.ordinal( NaN ), '' );
} );
test( 'sex words and the default span', () => {
	assert.strictEqual( L.sexFrom( 'F' ), 'girl' );
	assert.strictEqual( L.sexFrom( 'M' ), 'boy' );
	assert.strictEqual( L.sexFrom( 'boy' ), 'boy' );
	assert.strictEqual( L.sexFrom( '' ), 'girl' );
	assert.strictEqual( L.sexFrom( undefined ), 'girl' );
	assert.strictEqual( L.defaultSpan( 6.2 ), 7 );
	assert.strictEqual( L.defaultSpan( 6 ), 6 );
	assert.strictEqual( L.defaultSpan( 0.3 ), 1 );
	assert.strictEqual( L.defaultSpan( 30 ), 24 );
	assert.strictEqual( L.defaultSpan( NaN ), 1 );
} );
test( 'dates: ISO, plain date (local midnight), epoch seconds and milliseconds', () => {
	assert.strictEqual( L.parseWhen( '2026-04-20' ), new Date( 2026, 3, 20 ).getTime() );
	assert.strictEqual( L.parseWhen( '2026-04-20T10:00:00+00:00' ), Date.parse( '2026-04-20T10:00:00Z' ) );
	assert.strictEqual( L.parseWhen( 1776700000 ), 1776700000000 );
	assert.strictEqual( L.parseWhen( 1776700000000 ), 1776700000000 );
	assert.strictEqual( L.parseWhen( '1776700000' ), 1776700000000 );
	assert.ok( Number.isNaN( L.parseWhen( '' ) ) );
	assert.ok( Number.isNaN( L.parseWhen( null ) ) );
	assert.strictEqual( L.ageText( new Date( 2026, 3, 20 ).getTime(), new Date( 2026, 9, 27 ).getTime() ), '6 mo 7 d' );
	assert.strictEqual( L.ageText( new Date( 2026, 9, 1 ).getTime(), new Date( 2026, 9, 27 ).getTime() ), '3 wk 5 d' );
	assert.strictEqual( L.ageText( new Date( 2026, 9, 20 ).getTime(), new Date( 2026, 9, 27 ).getTime() ), '7 d' );
	assert.strictEqual( L.ageText( new Date( 2024, 6, 1 ).getTime(), new Date( 2026, 9, 27 ).getTime() ), '2 yr 3 mo' );
} );
test( 'nice ticks', () => {
	assert.deepStrictEqual( L.niceTicks( 2.8, 12.1, 6 ).ticks, [ 4, 6, 8, 10, 12 ] );
	assert.deepStrictEqual( L.niceTicks( 45, 92, 6 ).ticks, [ 50, 60, 70, 80, 90 ] );
	assert.strictEqual( L.niceTicks( 5, 5, 6 ).ticks.length > 0, true );
} );
test( 'the chart: five labelled curves, the child\'s points, today, axes in the display unit', () => {
	const colors = { accent: '#03a9f4', band: '#03a9f4', curve: '#777', grid: '#ccc', text: '#777', bg: '#fff' };
	const points = [ { time: Date.parse( '2026-04-20T12:00:00Z' ), months: 0, metric: 3.2, unit: 'kg' }, { time: Date.parse( '2026-10-20T12:00:00Z' ), months: 6, metric: 7.3, unit: 'kg' } ];
	const svg = L.chartSvg( { measure: 'weight', sex: 'girl', unit: 'lb', span: 12, points, width: 375, todayMonths: 6.2, selected: 1, colors } );
	assert.ok( svg.startsWith( '<svg' ) && svg.endsWith( '</svg>' ) );
	for ( const p of [ 3, 15, 50, 85, 97 ] ) {
		assert.ok( new RegExp( '>' + p + '</text>' ).test( svg ), 'label ' + p );
	}
	assert.strictEqual( ( svg.match( /class="pt"/g ) || [] ).length, 2 );
	assert.ok( /16 lb 1 oz · 5\dth/.test( svg ), 'tooltip in lb with the percentile' );
	assert.ok( svg.includes( '>lb</text>' ) );
	assert.ok( svg.includes( 'Age (months)' ) );
	assert.ok( svg.includes( 'stroke-dasharray="2 4"' ), 'today line' );
	assert.ok( /r="6"/.test( svg ), 'the selected point is bigger' );
	// A point past the span is left out of the drawing, not the series.
	const wide = L.chartSvg( { measure: 'length', sex: 'boy', unit: 'cm', span: 3, points: points.map( ( p ) => ( { ...p, metric: 60 } ) ), width: 1200, todayMonths: 6.2, selected: -1, colors } );
	assert.strictEqual( ( wide.match( /class="pt"/g ) || [] ).length, 1 );
	assert.ok( wide.includes( 'viewBox="0 0 1200 380"' ) );
} );

console.log( 'The browser cache' );
function fakeStorage() {
	const m = new Map();
	return { getItem: ( k ) => ( m.has( k ) ? m.get( k ) : null ), setItem: ( k, v ) => m.set( k, String( v ) ), removeItem: ( k ) => m.delete( k ), _m: m };
}
test( 'keyed by the calendar entity; written entries read back; junk and other versions ignored', () => {
	const st = fakeStorage();
	assert.strictEqual( L.cacheKey( 'calendar.child_events' ), 'huckleberry-growth:calendar.child_events' );
	assert.strictEqual( L.readCache( st, 'calendar.child_events' ), null );
	const entries = [ { time: 1000, weight: { value: 3.2, unit: 'kg' }, height: null, head: null } ];
	assert.strictEqual( L.writeCache( st, 'calendar.child_events', entries, 5000 ), true );
	assert.deepStrictEqual( L.readCache( st, 'calendar.child_events' ), { entries, to: 5000 } );
	st.setItem( 'huckleberry-growth:calendar.other_events', '{"v":0,"entries":[]}' );
	assert.strictEqual( L.readCache( st, 'calendar.other_events' ), null );
	st.setItem( 'huckleberry-growth:calendar.bad_events', 'not json' );
	assert.strictEqual( L.readCache( st, 'calendar.bad_events' ), null );
	L.clearCache( st, 'calendar.child_events' );
	assert.strictEqual( L.readCache( st, 'calendar.child_events' ), null );
	assert.strictEqual( L.writeCache( null, 'calendar.child_events', entries, 1 ), false );
	assert.strictEqual( L.writeCache( { setItem() { throw new Error( 'full' ); } }, 'calendar.x', entries, 1 ), false );
} );
test( 'merging: one entry per time, the fresh copy replacing the cached one, sorted', () => {
	const t1 = Date.parse( '2026-05-20T10:00:00Z' );
	const t2 = Date.parse( '2026-06-22T10:00:00Z' );
	const cached = [ { time: t2, weight: { value: 5, unit: 'kg' } }, { time: t1, weight: { value: 4.1, unit: 'kg' } } ];
	const fresh = [ { time: t2 + 20000, weight: { value: 5.1, unit: 'kg' } }, { time: Date.parse( '2026-08-21T10:00:00Z' ), weight: { value: 6.3, unit: 'kg' } } ];
	const merged = L.mergeEntries( cached, fresh );
	assert.deepStrictEqual( merged.map( ( e ) => e.weight.value ), [ 4.1, 5.1, 6.3 ] );
	assert.deepStrictEqual( L.mergeEntries( null, null ), [] );
} );
test( 'the next read starts a day before the last cached event, else a day before birth', () => {
	const now = Date.parse( '2026-10-27T12:00:00Z' );
	const birth = Date.parse( '2026-04-20T00:00:00Z' );
	const last = Date.parse( '2026-10-20T10:00:00Z' );
	assert.strictEqual( L.fetchStart( { entries: [ { time: birth }, { time: last } ], to: now - 3600000 }, birth, now ), last - 86400000 );
	assert.strictEqual( L.fetchStart( { entries: [], to: now - 7 * 86400000 }, birth, now ), now - 8 * 86400000 );
	assert.strictEqual( L.fetchStart( null, birth, now ), birth - 86400000 );
	assert.strictEqual( L.fetchStart( null, NaN, now ), now - 2 * 366 * 86400000 );
} );

console.log( '' );
console.log( process.exitCode ? 'Some checks failed.' : passed + ' checks passed.' );
