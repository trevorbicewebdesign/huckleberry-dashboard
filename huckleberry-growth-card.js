/**
 * Huckleberry growth card — a Home Assistant custom card.
 *
 * Plots a child's weight, length and head circumference from Huckleberry (Woyken's integration)
 * against the WHO Child Growth Standards percentile curves (0–24 months), with the current
 * percentile of each measure in a header strip. One file, no build step, no library.
 *
 * Config (YAML):
 *   type: custom:huckleberry-growth-card
 *   growth_entity: sensor.<child>_growth        # required: the child's growth sensor
 *   calendar_entity: calendar.<child>_events    # default: derived from growth_entity; every past
 *                                               # measurement is read from its "Growth Measurement" events
 *   profile_entity: sensor.<child>_profile      # default: derived; gives birth date, sex and name
 *   child_name: <name>                          # default: the profile's name
 *   birth_date: YYYY-MM-DD                      # default: the profile's birthday attribute
 *   sex: girl | boy                             # default: the profile's gender, else girl
 *   units: metric | imperial                    # default: the unit each measurement was logged in
 *   measure: weight | length | head             # the tab shown first (default weight)
 *   months: 1–24                                # x-axis span (default: the child's age, rounded up)
 *   events: [ ... ]                             # test fixture instead of the calendar (see README)
 *
 * The card keeps a global here only to register with the card picker.
 */
( () => {
	'use strict';

	const CARD = 'huckleberry-growth-card';
	const EDITOR = 'huckleberry-growth-card-editor';

	const MEASURES = [
		{ id: 'weight', label: 'Weight', metric: 'kg', imperial: 'lb', eventKey: 'weight' },
		{ id: 'length', label: 'Length', metric: 'cm', imperial: 'in', eventKey: 'height' },
		{ id: 'head', label: 'Head', metric: 'cm', imperial: 'in', eventKey: 'head' },
	];
	// The curves drawn, with the z-score of each percentile.
	const PERCENTILES = [
		{ p: 3, z: -1.8808 }, { p: 15, z: -1.0364 }, { p: 50, z: 0 }, { p: 85, z: 1.0364 }, { p: 97, z: 1.8808 },
	];
	const DAYS_PER_MONTH = 30.4375; // WHO: age in months = days / 30.4375
	const MAX_MONTHS = 24;
	const LB_PER_KG = 2.2046226218;
	const CM_PER_IN = 2.54;
	const SAME_MEASUREMENT_MS = 60 * 1000;
	const REFRESH_MS = 30 * 60 * 1000;

	/**
	 * WHO Child Growth Standards (2006), LMS parameters by completed month, 0–24, [L, M, S].
	 * Weight-for-age, length-for-age and head-circumference-for-age, girls and boys.
	 * Source: the WHO z-score tables (www.who.int/tools/child-growth-standards/standards).
	 */
	const WHO = {
		weight: {
			girl: [
				[ 0.3809, 3.2322, 0.14171 ], [ 0.1714, 4.1873, 0.13724 ], [ 0.0962, 5.1282, 0.13 ], [ 0.0402, 5.8458, 0.12619 ], [ -0.005, 6.4237, 0.12402 ],
				[ -0.043, 6.8985, 0.12274 ], [ -0.0756, 7.297, 0.12204 ], [ -0.1039, 7.6422, 0.12178 ], [ -0.1288, 7.9487, 0.12181 ], [ -0.1507, 8.2254, 0.12199 ],
				[ -0.17, 8.48, 0.12223 ], [ -0.1872, 8.7192, 0.12247 ], [ -0.2024, 8.9481, 0.12268 ], [ -0.2158, 9.1699, 0.12283 ], [ -0.2278, 9.387, 0.12294 ],
				[ -0.2384, 9.6008, 0.12299 ], [ -0.2478, 9.8124, 0.12303 ], [ -0.2562, 10.0226, 0.12306 ], [ -0.2637, 10.2315, 0.12309 ], [ -0.2703, 10.4393, 0.12315 ],
				[ -0.2762, 10.6464, 0.12323 ], [ -0.2815, 10.8534, 0.12335 ], [ -0.2862, 11.0608, 0.1235 ], [ -0.2903, 11.2688, 0.12369 ], [ -0.2941, 11.4775, 0.1239 ],
			],
			boy: [
				[ 0.3487, 3.3464, 0.14602 ], [ 0.2297, 4.4709, 0.13395 ], [ 0.197, 5.5675, 0.12385 ], [ 0.1738, 6.3762, 0.11727 ], [ 0.1553, 7.0023, 0.11316 ],
				[ 0.1395, 7.5105, 0.1108 ], [ 0.1257, 7.934, 0.10958 ], [ 0.1134, 8.297, 0.10902 ], [ 0.1021, 8.6151, 0.10882 ], [ 0.0917, 8.9014, 0.10881 ],
				[ 0.082, 9.1649, 0.10891 ], [ 0.073, 9.4122, 0.10906 ], [ 0.0644, 9.6479, 0.10925 ], [ 0.0563, 9.8749, 0.10949 ], [ 0.0487, 10.0953, 0.10976 ],
				[ 0.0413, 10.3108, 0.11007 ], [ 0.0343, 10.5228, 0.11041 ], [ 0.0275, 10.7319, 0.11079 ], [ 0.0211, 10.9385, 0.11119 ], [ 0.0148, 11.143, 0.11164 ],
				[ 0.0087, 11.3462, 0.11211 ], [ 0.0029, 11.5486, 0.11261 ], [ -0.0028, 11.7504, 0.11314 ], [ -0.0083, 11.9514, 0.11369 ], [ -0.0137, 12.1515, 0.11426 ],
			],
		},
		length: {
			girl: [
				[ 1, 49.1477, 0.0379 ], [ 1, 53.6872, 0.0364 ], [ 1, 57.0673, 0.03568 ], [ 1, 59.8029, 0.0352 ], [ 1, 62.0899, 0.03486 ],
				[ 1, 64.0301, 0.03463 ], [ 1, 65.7311, 0.03448 ], [ 1, 67.2873, 0.03441 ], [ 1, 68.7498, 0.0344 ], [ 1, 70.1435, 0.03444 ],
				[ 1, 71.4818, 0.03452 ], [ 1, 72.771, 0.03464 ], [ 1, 74.015, 0.03479 ], [ 1, 75.2176, 0.03496 ], [ 1, 76.3817, 0.03514 ],
				[ 1, 77.5099, 0.03534 ], [ 1, 78.6055, 0.03555 ], [ 1, 79.671, 0.03576 ], [ 1, 80.7079, 0.03598 ], [ 1, 81.7182, 0.0362 ],
				[ 1, 82.7036, 0.03643 ], [ 1, 83.6654, 0.03666 ], [ 1, 84.604, 0.03688 ], [ 1, 85.5202, 0.03711 ], [ 1, 86.4153, 0.03734 ],
			],
			boy: [
				[ 1, 49.8842, 0.03795 ], [ 1, 54.7244, 0.03557 ], [ 1, 58.4249, 0.03424 ], [ 1, 61.4292, 0.03328 ], [ 1, 63.886, 0.03257 ],
				[ 1, 65.9026, 0.03204 ], [ 1, 67.6236, 0.03165 ], [ 1, 69.1645, 0.03139 ], [ 1, 70.5994, 0.03124 ], [ 1, 71.9687, 0.03117 ],
				[ 1, 73.2812, 0.03118 ], [ 1, 74.5388, 0.03125 ], [ 1, 75.7488, 0.03137 ], [ 1, 76.9186, 0.03154 ], [ 1, 78.0497, 0.03174 ],
				[ 1, 79.1458, 0.03197 ], [ 1, 80.2113, 0.03222 ], [ 1, 81.2487, 0.0325 ], [ 1, 82.2587, 0.03279 ], [ 1, 83.2418, 0.0331 ],
				[ 1, 84.1996, 0.03342 ], [ 1, 85.1348, 0.03376 ], [ 1, 86.0477, 0.0341 ], [ 1, 86.941, 0.03445 ], [ 1, 87.8161, 0.03479 ],
			],
		},
		head: {
			girl: [
				[ 1, 33.8787, 0.03496 ], [ 1, 36.5463, 0.0321 ], [ 1, 38.2521, 0.03168 ], [ 1, 39.5328, 0.0314 ], [ 1, 40.5817, 0.03119 ],
				[ 1, 41.459, 0.03102 ], [ 1, 42.1995, 0.03087 ], [ 1, 42.829, 0.03075 ], [ 1, 43.3671, 0.03063 ], [ 1, 43.83, 0.03053 ],
				[ 1, 44.2319, 0.03044 ], [ 1, 44.5844, 0.03035 ], [ 1, 44.8965, 0.03027 ], [ 1, 45.1752, 0.03019 ], [ 1, 45.4265, 0.03012 ],
				[ 1, 45.6551, 0.03006 ], [ 1, 45.865, 0.02999 ], [ 1, 46.0598, 0.02993 ], [ 1, 46.2424, 0.02987 ], [ 1, 46.4152, 0.02982 ],
				[ 1, 46.5801, 0.02977 ], [ 1, 46.7384, 0.02972 ], [ 1, 46.8913, 0.02967 ], [ 1, 47.0391, 0.02962 ], [ 1, 47.1822, 0.02957 ],
			],
			boy: [
				[ 1, 34.4618, 0.03686 ], [ 1, 37.2759, 0.03133 ], [ 1, 39.1285, 0.02997 ], [ 1, 40.5135, 0.02918 ], [ 1, 41.6317, 0.02868 ],
				[ 1, 42.5576, 0.02837 ], [ 1, 43.3306, 0.02817 ], [ 1, 43.9803, 0.02804 ], [ 1, 44.53, 0.02796 ], [ 1, 44.9998, 0.02792 ],
				[ 1, 45.4051, 0.0279 ], [ 1, 45.7573, 0.02789 ], [ 1, 46.0661, 0.02789 ], [ 1, 46.3395, 0.02789 ], [ 1, 46.5844, 0.02791 ],
				[ 1, 46.806, 0.02792 ], [ 1, 47.0088, 0.02795 ], [ 1, 47.1962, 0.02797 ], [ 1, 47.3711, 0.028 ], [ 1, 47.5357, 0.02803 ],
				[ 1, 47.6919, 0.02806 ], [ 1, 47.8408, 0.0281 ], [ 1, 47.9833, 0.02813 ], [ 1, 48.1201, 0.02817 ], [ 1, 48.2515, 0.02821 ],
			],
		},
	};

	/* ---- Pure logic (also what tests/check-growth.js exercises) --------------------------- */

	// Unit words as the calendar text and the sensor's attributes spell them. Huckleberry's unit
	// codes are kg / lbs.oz (weight in decimal pounds), cm / ft.in (height in inches, labelled
	// "ft" in the calendar text) and hcm / hin (head circumference).
	const UNIT_WORDS = {
		kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
		lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', 'lbs.oz': 'lb',
		oz: 'oz', ounce: 'oz', ounces: 'oz',
		cm: 'cm', hcm: 'cm', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
		in: 'in', hin: 'in', inch: 'in', inches: 'in', '"': 'in',
		ft: 'ft', 'ft.in': 'ft', feet: 'ft', foot: 'ft',
	};

	/**
	 * A measurement from text: "12.3 lb", "7 lb 4 oz", "65.7 cm", "24 in", "7.3 kg", "24 ft.in".
	 * Returns { value, unit } with unit kg | lb | cm | in, or '' when the text names none, or null.
	 * "ft" is Huckleberry's label for its ft.in setting, whose values are inches; a number under 10
	 * with "ft" is taken as real feet (no baby measures under 10 inches).
	 */
	function parseMeasurement( text ) {
		const parts = [];
		const re = /(-?\d+(?:[.,]\d+)?)\s*([a-zA-Z"][a-zA-Z."]*)?/g;
		let m;
		while ( ( m = re.exec( String( text == null ? '' : text ) ) ) ) {
			const word = ( m[ 2 ] || '' ).toLowerCase().replace( /\.+$/, '' );
			parts.push( { value: parseFloat( m[ 1 ].replace( ',', '.' ) ), unit: UNIT_WORDS[ word ] || '' } );
		}
		if ( ! parts.length || ! Number.isFinite( parts[ 0 ].value ) ) {
			return null;
		}
		const first = parts[ 0 ];
		const second = parts[ 1 ];
		if ( first.unit === 'lb' || first.unit === 'oz' ) {
			let lb = first.unit === 'lb' ? first.value : first.value / 16;
			if ( first.unit === 'lb' && second && second.unit === 'oz' ) {
				lb += second.value / 16;
			}
			return { value: lb, unit: 'lb' };
		}
		if ( first.unit === 'ft' ) {
			if ( second && second.unit === 'in' ) {
				return { value: first.value * 12 + second.value, unit: 'in' };
			}
			return { value: first.value >= 10 ? first.value : first.value * 12, unit: 'in' };
		}
		return { value: first.value, unit: first.unit };
	}

	/** kg or cm from a parsed measurement; a unit-less value is taken as metric already. */
	function toMetric( m, measure ) {
		if ( ! m || ! Number.isFinite( m.value ) ) {
			return NaN;
		}
		if ( measure === 'weight' ) {
			return m.unit === 'lb' ? m.value / LB_PER_KG : m.value;
		}
		return m.unit === 'in' ? m.value * CM_PER_IN : m.value;
	}

	/** The display value in a unit (kg | lb | cm | in) from kg or cm. */
	function fromMetric( metric, unit ) {
		if ( unit === 'lb' ) {
			return metric * LB_PER_KG;
		}
		if ( unit === 'in' ) {
			return metric / CM_PER_IN;
		}
		return metric;
	}

	/** A time (ms) from an ISO string, a YYYY-MM-DD date (local midnight), or an epoch number. */
	function parseWhen( value ) {
		if ( value == null || value === '' ) {
			return NaN;
		}
		if ( typeof value === 'number' ) {
			return value > 1e11 ? value : value * 1000;
		}
		const s = String( value ).trim();
		const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec( s );
		if ( d ) {
			return new Date( Number( d[ 1 ] ), Number( d[ 2 ] ) - 1, Number( d[ 3 ] ) ).getTime();
		}
		if ( /^\d+(\.\d+)?$/.test( s ) ) {
			return parseWhen( Number( s ) );
		}
		return Date.parse( s );
	}

	/**
	 * A growth event from HA's calendar API ({ start: { dateTime | date }, summary, description })
	 * → { time, weight, height, head } (each a parsed measurement or null), or null when the event
	 * is not a growth measurement. The integration writes "📏 Growth Measurement" with description
	 * lines "Growth measurement" / "Weight: 7.3 kg" / "Height: 65 cm" / "Head: 42 cm".
	 */
	function parseGrowthEvent( ev ) {
		if ( ! ev || typeof ev !== 'object' ) {
			return null;
		}
		const description = String( ev.description || '' );
		const summary = String( ev.summary || '' );
		if ( ! /growth/i.test( summary ) && ! /^\s*growth measurement/im.test( description ) ) {
			return null;
		}
		const start = ev.start && typeof ev.start === 'object' ? ( ev.start.dateTime || ev.start.date ) : ev.start;
		const time = parseWhen( start );
		if ( ! Number.isFinite( time ) ) {
			return null;
		}
		const out = { time, weight: null, height: null, head: null };
		for ( const line of description.split( /\r?\n/ ) ) {
			const m = /^\s*(weight|height|length|head)(?:\s*circumference)?\s*:\s*(.+)$/i.exec( line );
			if ( ! m ) {
				continue;
			}
			const word = m[ 1 ].toLowerCase();
			const key = word === 'length' ? 'height' : word;
			const parsed = parseMeasurement( m[ 2 ] );
			if ( parsed && parsed.value > 0 ) {
				out[ key ] = parsed;
			}
		}
		return out.weight || out.height || out.head ? out : null;
	}

	/** The latest measurement from sensor.<child>_growth's state object, in the same shape. */
	function sensorLatest( state ) {
		if ( ! state || ! state.attributes ) {
			return null;
		}
		const a = state.attributes;
		const time = parseWhen( state.state );
		if ( ! Number.isFinite( time ) ) {
			return null;
		}
		const take = ( value, unit ) => ( value == null || value === '' ? null : parseMeasurement( String( value ) + ' ' + String( unit || '' ) ) );
		const out = {
			time,
			weight: take( a.weight, a.weight_unit ),
			height: take( a.height, a.height_unit ),
			head: take( a.head_circumference, a.head_unit ),
		};
		return out.weight || out.height || out.head ? out : null;
	}

	/**
	 * A fixture entry from the `events` config key: either HA's calendar event shape, or
	 * { date, weight, height (or length), head } with measurement text or numbers (metric).
	 */
	function parseFixtureEvent( item ) {
		if ( ! item || typeof item !== 'object' ) {
			return null;
		}
		if ( item.description !== undefined || item.summary !== undefined ) {
			return parseGrowthEvent( item );
		}
		const time = parseWhen( item.date || item.time || item.start );
		if ( ! Number.isFinite( time ) ) {
			return null;
		}
		const out = {
			time,
			weight: parseMeasurement( item.weight ),
			height: parseMeasurement( item.height !== undefined ? item.height : item.length ),
			head: parseMeasurement( item.head ),
		};
		return out.weight || out.height || out.head ? out : null;
	}

	/** Age in months (WHO: days / 30.4375) at a time. */
	function ageMonths( birth, time ) {
		return ( time - birth ) / ( 86400000 * DAYS_PER_MONTH );
	}

	/**
	 * The three series from parsed entries (calendar events, the sensor's latest, fixtures):
	 * { weight: [ { time, months, metric, unit } ], length: [...], head: [...] }, sorted by time.
	 * Two entries within a minute of each other are one measurement (the sensor's latest is the
	 * last calendar event most of the time), so the later copy is dropped.
	 */
	function seriesFrom( entries, birth ) {
		const out = { weight: [], length: [], head: [] };
		const sorted = ( entries || [] ).filter( ( e ) => e && Number.isFinite( e.time ) ).sort( ( a, b ) => a.time - b.time );
		for ( const e of sorted ) {
			for ( const ms of MEASURES ) {
				const raw = e[ ms.eventKey ];
				if ( ! raw || ! ( raw.value > 0 ) ) {
					continue;
				}
				const list = out[ ms.id ];
				const last = list[ list.length - 1 ];
				if ( last && Math.abs( last.time - e.time ) < SAME_MEASUREMENT_MS ) {
					continue;
				}
				list.push( {
					time: e.time,
					months: Number.isFinite( birth ) ? ageMonths( birth, e.time ) : NaN,
					metric: toMetric( raw, ms.id ),
					unit: raw.unit || ms.metric,
				} );
			}
		}
		return out;
	}

	/** [L, M, S] at an age in months, interpolated between the table's months; null off the table. */
	function lmsAt( measure, sex, months ) {
		const table = WHO[ measure ] && WHO[ measure ][ sex ];
		if ( ! table || ! Number.isFinite( months ) || months < -0.01 || months > MAX_MONTHS + 0.5 ) {
			return null;
		}
		const m = Math.min( Math.max( months, 0 ), MAX_MONTHS );
		const i = Math.min( Math.floor( m ), MAX_MONTHS - 1 );
		const t = m - i;
		const a = table[ i ];
		const b = table[ i + 1 ];
		return [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t ];
	}

	/** z = ((x/M)^L − 1) / (L·S), or ln(x/M)/S when L is 0. */
	function zScore( x, lms ) {
		if ( ! lms || ! ( x > 0 ) ) {
			return NaN;
		}
		const [ L, M, S ] = lms;
		return Math.abs( L ) < 1e-9 ? Math.log( x / M ) / S : ( Math.pow( x / M, L ) - 1 ) / ( L * S );
	}

	/** The measurement at a z-score: M·(1 + L·S·z)^(1/L). */
	function valueAtZ( lms, z ) {
		const [ L, M, S ] = lms;
		return Math.abs( L ) < 1e-9 ? M * Math.exp( S * z ) : M * Math.pow( 1 + L * S * z, 1 / L );
	}

	/** The standard normal CDF (Abramowitz & Stegun 7.1.26, within 1.5e-7). */
	function normalCdf( z ) {
		if ( ! Number.isFinite( z ) ) {
			return NaN;
		}
		const t = 1 / ( 1 + 0.3275911 * Math.abs( z ) / Math.SQRT2 );
		const y = 1 - ( ( ( ( 1.061405429 * t - 1.453152027 ) * t + 1.421413741 ) * t - 0.284496736 ) * t + 0.254829592 ) * t * Math.exp( -z * z / 2 );
		return 0.5 * ( 1 + ( z < 0 ? -y : y ) );
	}

	/** The percentile (0–100) of a metric value at an age, or NaN off the table. */
	function percentileOf( measure, sex, months, metric ) {
		const lms = lmsAt( measure, sex, months );
		return lms ? 100 * normalCdf( zScore( metric, lms ) ) : NaN;
	}

	/** "54th", "<1st", ">99th", or '' for NaN. */
	function ordinal( p ) {
		if ( ! Number.isFinite( p ) ) {
			return '';
		}
		if ( p < 0.5 ) {
			return '<1st';
		}
		if ( p >= 99.5 ) {
			return '>99th';
		}
		const n = Math.round( p );
		const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : [ 'th', 'st', 'nd', 'rd' ][ n % 10 ] || 'th';
		return n + suffix;
	}

	/** girl | boy from the profile's gender (M/F) or the config's word; girl by default. */
	function sexFrom( value ) {
		const s = String( value == null ? '' : value ).trim().toLowerCase();
		if ( s === 'm' || s === 'boy' || s === 'male' ) {
			return 'boy';
		}
		return 'girl';
	}

	/** The x-axis span: the child's age rounded up, at least 1 month, at most 24. */
	function defaultSpan( months ) {
		if ( ! Number.isFinite( months ) || months <= 0 ) {
			return 1;
		}
		return Math.min( MAX_MONTHS, Math.max( 1, Math.ceil( months - 0.01 ) ) );
	}

	/** Nice axis ticks covering [min, max]: 1/2/5 × 10^k steps, about `count` of them. */
	function niceTicks( min, max, count ) {
		if ( ! ( max > min ) ) {
			max = min + 1;
		}
		const rough = ( max - min ) / Math.max( 2, count || 5 );
		const pow = Math.pow( 10, Math.floor( Math.log10( rough ) ) );
		const step = [ 1, 2, 2.5, 5, 10 ].map( ( s ) => s * pow ).find( ( s ) => s >= rough ) || 10 * pow;
		const first = Math.ceil( min / step ) * step;
		const ticks = [];
		for ( let v = first; v <= max + step * 1e-6; v += step ) {
			ticks.push( Number( v.toFixed( 10 ) ) );
		}
		return { step, ticks };
	}

	/** A display value: "7.3 kg", "3.25 kg", "16 lb 2 oz", "65.7 cm", "24.5 in". */
	function formatValue( metric, unit ) {
		if ( ! Number.isFinite( metric ) ) {
			return '';
		}
		const v = fromMetric( metric, unit );
		if ( unit === 'lb' ) {
			let lb = Math.floor( v );
			let oz = Math.round( ( v - lb ) * 16 );
			if ( oz === 16 ) {
				lb += 1;
				oz = 0;
			}
			return lb + ' lb ' + oz + ' oz';
		}
		const decimals = unit === 'kg' ? 2 : 1;
		return trimZeros( v.toFixed( decimals ) ) + ' ' + unit;
	}

	function trimZeros( s ) {
		return String( s ).replace( /\.0+$/, '' ).replace( /(\.\d*?)0+$/, '$1' );
	}

	/** "6 mo 3 d", "3 wk 2 d", "12 d", "1 yr 2 mo" from two times. */
	function ageText( birth, now ) {
		if ( ! Number.isFinite( birth ) || ! Number.isFinite( now ) || now < birth ) {
			return '';
		}
		const b = new Date( birth );
		const n = new Date( now );
		let months = ( n.getFullYear() - b.getFullYear() ) * 12 + ( n.getMonth() - b.getMonth() );
		let anchor = new Date( b.getFullYear(), b.getMonth() + months, b.getDate() );
		if ( anchor > n ) {
			months -= 1;
			anchor = new Date( b.getFullYear(), b.getMonth() + months, b.getDate() );
		}
		const days = Math.floor( ( n - anchor ) / 86400000 );
		if ( months < 1 ) {
			const total = Math.floor( ( n - b ) / 86400000 );
			return total < 14 ? total + ' d' : Math.floor( total / 7 ) + ' wk' + ( total % 7 ? ' ' + total % 7 + ' d' : '' );
		}
		if ( months < 24 ) {
			return months + ' mo' + ( days ? ' ' + days + ' d' : '' );
		}
		return Math.floor( months / 12 ) + ' yr' + ( months % 12 ? ' ' + months % 12 + ' mo' : '' );
	}

	function dateText( time, locale ) {
		try {
			return new Date( time ).toLocaleDateString( locale || undefined, { year: 'numeric', month: 'short', day: 'numeric' } );
		} catch {
			return new Date( time ).toDateString();
		}
	}

	/** Words for an error from hass.callApi. */
	function errorText( err, fallback ) {
		if ( ! err ) {
			return fallback;
		}
		if ( typeof err === 'string' ) {
			return err;
		}
		if ( err.body && typeof err.body === 'object' && err.body.message ) {
			return String( err.body.message );
		}
		if ( err.message ) {
			return String( err.message );
		}
		return fallback;
	}

	function escapeHtml( s ) {
		return String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );
	}

	/* ---- The chart (an SVG string) ------------------------------------------------------- */

	/**
	 * Draws one measure: the five WHO percentile curves (bands between 3–97 and 15–85), the
	 * child's points joined by a line, a dashed line at today's age, axes in months and `unit`.
	 * `points` are the series entries; `selected` is the index of the tapped point.
	 */
	function chartSvg( opts ) {
		const { measure, sex, unit, span, points, width, todayMonths, selected, colors } = opts;
		const w = Math.max( 240, Math.round( width || 320 ) );
		const h = Math.round( Math.min( 380, Math.max( 220, w * 0.58 ) ) );
		const pad = { top: 12, right: 30, bottom: 30, left: 46 };
		const pw = w - pad.left - pad.right;
		const ph = h - pad.top - pad.bottom;
		const xMax = Math.max( 1, span );
		const step = 0.25;

		// Curves in display units.
		const curves = PERCENTILES.map( ( pc ) => {
			const pts = [];
			for ( let m = 0; m <= xMax + 1e-9; m += step ) {
				const lms = lmsAt( measure, sex, Math.min( m, MAX_MONTHS ) );
				if ( lms ) {
					pts.push( [ m, fromMetric( valueAtZ( lms, pc.z ), unit ) ] );
				}
			}
			return { p: pc.p, pts };
		} );
		const shown = points.filter( ( p ) => Number.isFinite( p.months ) && Number.isFinite( p.metric ) && p.months >= -0.01 && p.months <= xMax + 0.01 );
		const ys = [];
		for ( const c of curves ) {
			for ( const [ , y ] of c.pts ) {
				ys.push( y );
			}
		}
		for ( const p of shown ) {
			ys.push( fromMetric( p.metric, unit ) );
		}
		let yMin = Math.min.apply( null, ys );
		let yMax = Math.max.apply( null, ys );
		const spread = Math.max( yMax - yMin, 1e-6 );
		yMin -= spread * 0.05;
		yMax += spread * 0.05;
		const yTicks = niceTicks( yMin, yMax, h < 260 ? 4 : 6 );
		yMin = Math.min( yMin, yTicks.ticks[ 0 ] - yTicks.step * 0.2 );
		const xStep = xMax <= 8 ? 1 : xMax <= 16 ? 2 : 3;
		const X = ( m ) => pad.left + ( m / xMax ) * pw;
		const Y = ( v ) => pad.top + ph - ( ( v - yMin ) / ( yMax - yMin ) ) * ph;
		const f = ( n ) => Math.round( n * 10 ) / 10;
		const line = ( pts ) => pts.map( ( [ m, v ], i ) => ( i ? 'L' : 'M' ) + f( X( m ) ) + ' ' + f( Y( v ) ) ).join( '' );
		const band = ( lo, hi ) => line( hi.pts ) + lo.pts.slice().reverse().map( ( [ m, v ] ) => 'L' + f( X( m ) ) + ' ' + f( Y( v ) ) ).join( '' ) + 'Z';
		const byP = {};
		for ( const c of curves ) {
			byP[ c.p ] = c;
		}

		let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ w } ${ h }" width="${ w }" height="${ h }" role="img" aria-label="${ escapeHtml( measure ) } against WHO percentiles" style="display:block;max-width:100%;height:auto;font:11px sans-serif">`;
		s += `<path d="${ band( byP[ 3 ], byP[ 97 ] ) }" fill="${ colors.band }" fill-opacity="0.08"/>`;
		s += `<path d="${ band( byP[ 15 ], byP[ 85 ] ) }" fill="${ colors.band }" fill-opacity="0.10"/>`;
		// Grid and axes.
		for ( const t of yTicks.ticks ) {
			s += `<line x1="${ pad.left }" x2="${ w - pad.right }" y1="${ f( Y( t ) ) }" y2="${ f( Y( t ) ) }" stroke="${ colors.grid }" stroke-opacity="0.35"/>`;
			s += `<text x="${ pad.left - 6 }" y="${ f( Y( t ) + 3.5 ) }" text-anchor="end" fill="${ colors.text }">${ trimZeros( t.toFixed( 2 ) ) }</text>`;
		}
		for ( let m = 0; m <= xMax; m += xStep ) {
			s += `<line x1="${ f( X( m ) ) }" x2="${ f( X( m ) ) }" y1="${ pad.top }" y2="${ pad.top + ph }" stroke="${ colors.grid }" stroke-opacity="0.25"/>`;
			s += `<text x="${ f( X( m ) ) }" y="${ pad.top + ph + 14 }" text-anchor="middle" fill="${ colors.text }">${ m }</text>`;
		}
		s += `<line x1="${ pad.left }" x2="${ w - pad.right }" y1="${ pad.top + ph }" y2="${ pad.top + ph }" stroke="${ colors.grid }"/>`;
		s += `<line x1="${ pad.left }" x2="${ pad.left }" y1="${ pad.top }" y2="${ pad.top + ph }" stroke="${ colors.grid }"/>`;
		s += `<text x="${ f( pad.left + pw / 2 ) }" y="${ h - 3 }" text-anchor="middle" fill="${ colors.text }" font-size="10">Age (months)</text>`;
		s += `<text x="4" y="${ pad.top + 4 }" fill="${ colors.text }" font-size="10">${ escapeHtml( unit ) }</text>`;
		// Curves and their labels.
		for ( const c of curves ) {
			const is50 = c.p === 50;
			s += `<path d="${ line( c.pts ) }" fill="none" stroke="${ colors.curve }" stroke-opacity="${ is50 ? 0.8 : 0.5 }" stroke-width="${ is50 ? 1.6 : 1 }"${ is50 ? '' : ' stroke-dasharray="3 3"' }/>`;
			const end = c.pts[ c.pts.length - 1 ];
			if ( end ) {
				s += `<text x="${ w - pad.right + 4 }" y="${ f( Y( end[ 1 ] ) + 3.5 ) }" fill="${ colors.text }" font-size="10">${ c.p }</text>`;
			}
		}
		// Today.
		if ( Number.isFinite( todayMonths ) && todayMonths >= 0 && todayMonths <= xMax ) {
			s += `<line x1="${ f( X( todayMonths ) ) }" x2="${ f( X( todayMonths ) ) }" y1="${ pad.top }" y2="${ pad.top + ph }" stroke="${ colors.accent }" stroke-opacity="0.5" stroke-dasharray="2 4"/>`;
		}
		// The child.
		if ( shown.length > 1 ) {
			s += `<path d="${ line( shown.map( ( p ) => [ p.months, fromMetric( p.metric, unit ) ] ) ) }" fill="none" stroke="${ colors.accent }" stroke-width="2" stroke-linejoin="round"/>`;
		}
		shown.forEach( ( p ) => {
			const i = points.indexOf( p );
			const cx = f( X( p.months ) );
			const cy = f( Y( fromMetric( p.metric, unit ) ) );
			const pct = ordinal( percentileOf( measure, sex, p.months, p.metric ) );
			const sel = i === selected;
			s += `<g class="pt" data-index="${ i }" style="cursor:pointer" tabindex="0" role="button" aria-label="${ escapeHtml( formatValue( p.metric, unit ) + ( pct ? ', ' + pct + ' percentile' : '' ) ) }">`;
			s += `<title>${ escapeHtml( dateText( p.time ) + ' · ' + formatValue( p.metric, unit ) + ( pct ? ' · ' + pct : '' ) ) }</title>`;
			s += `<circle cx="${ cx }" cy="${ cy }" r="14" fill="transparent"/>`;
			s += `<circle cx="${ cx }" cy="${ cy }" r="${ sel ? 6 : 4 }" fill="${ colors.accent }" stroke="${ colors.bg }" stroke-width="${ sel ? 2.5 : 1.5 }"/>`;
			s += '</g>';
		} );
		s += '</svg>';
		return s;
	}

	/* ---- The card ------------------------------------------------------------------------- */

	const STYLE = `
		:host { display: block; }
		ha-card { padding: 16px; box-sizing: border-box; overflow: hidden; }
		.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
		.title { font-size: 1.25rem; font-weight: 500; color: var(--primary-text-color); line-height: 1.3; }
		.sub { font-size: 0.875rem; color: var(--secondary-text-color); line-height: 1.3; }
		.tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
		.tile {
			appearance: none; -webkit-appearance: none; font: inherit; cursor: pointer; margin: 0;
			min-height: 64px; padding: 8px 6px; border-radius: 12px; text-align: left;
			border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
			background: var(--card-background-color, #fff); color: var(--primary-text-color);
			display: flex; flex-direction: column; gap: 2px; -webkit-tap-highlight-color: transparent;
			transition: background 120ms, border-color 120ms, color 120ms;
		}
		.tile:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
		.tile .l { font-size: 0.75rem; letter-spacing: 0.02em; color: var(--secondary-text-color); }
		.tile .v { font-size: 1rem; font-weight: 500; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.tile .p { font-size: 0.8125rem; color: var(--secondary-text-color); }
		.tile[aria-selected="true"] { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
		.tile[aria-selected="true"] .l, .tile[aria-selected="true"] .p { color: var(--text-primary-color, #fff); opacity: 0.85; }
		.chart { width: 100%; min-height: 220px; }
		.chart svg .pt:focus { outline: none; }
		.caption { min-height: 1.25rem; margin-top: 6px; font-size: 0.875rem; color: var(--secondary-text-color); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
		.caption b { color: var(--primary-text-color); font-weight: 500; }
		.note { font-size: 0.8125rem; color: var(--secondary-text-color); margin-top: 8px; }
		.warn {
			margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 0.875rem; line-height: 1.4;
			border: 1px solid var(--warning-color, #ffa600); color: var(--primary-text-color);
		}
		.error {
			margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 0.875rem; line-height: 1.4;
			background: var(--error-color, #db4437); color: var(--text-primary-color, #fff);
		}
	`;

	class HuckleberryGrowthCard extends HTMLElement {
		static getConfigElement() {
			return document.createElement( EDITOR );
		}

		static getStubConfig( hass ) {
			const entity = hass && hass.states
				? Object.keys( hass.states ).find( ( id ) => /^sensor\..*_growth$/.test( id ) )
				: undefined;
			return { growth_entity: entity || 'sensor.child_growth' };
		}

		constructor() {
			super();
			this.attachShadow( { mode: 'open' } );
			this._config = null;
			this._hass = null;
			this._measure = 'weight';
			this._selected = -1;
			this._events = [];
			this._eventsError = '';
			this._loading = false;
			this._fetchedKey = '';
			this._fetchedAt = 0;
			this._width = 0;
			this._built = false;
		}

		setConfig( config ) {
			if ( ! config || ! config.growth_entity ) {
				throw new Error( 'growth_entity is required: the child\'s growth sensor, such as sensor.<child>_growth.' );
			}
			if ( config.measure && ! MEASURES.some( ( m ) => m.id === config.measure ) ) {
				throw new Error( 'measure must be weight, length or head.' );
			}
			this._config = { ...config };
			this._measure = config.measure || 'weight';
			this._selected = -1;
			this._fetchedKey = '';
			this._events = [];
			this._eventsError = '';
			this._render();
			if ( this._hass ) {
				this._maybeFetch();
			}
		}

		set hass( hass ) {
			this._hass = hass;
			if ( ! this._config ) {
				return;
			}
			this._maybeFetch();
			this._render();
		}

		get hass() {
			return this._hass;
		}

		connectedCallback() {
			if ( typeof ResizeObserver !== 'undefined' && ! this._ro ) {
				this._ro = new ResizeObserver( ( entries ) => {
					const width = entries[ 0 ] && entries[ 0 ].contentRect ? entries[ 0 ].contentRect.width : this.clientWidth;
					if ( width && Math.abs( width - this._width ) > 1 ) {
						this._width = width;
						this._renderChart();
					}
				} );
				this._ro.observe( this );
			}
		}

		disconnectedCallback() {
			if ( this._ro ) {
				this._ro.disconnect();
				this._ro = null;
			}
		}

		getCardSize() {
			return 7;
		}

		getGridOptions() {
			return { columns: 'full', rows: 'auto' };
		}

		/* ---- derived settings ------------------------------------------------------------ */

		_childSlug() {
			const id = String( this._config.growth_entity ).split( '.' )[ 1 ] || '';
			return id.replace( /_growth$/, '' );
		}

		_state( id ) {
			return id && this._hass && this._hass.states ? this._hass.states[ id ] : undefined;
		}

		_profile() {
			return this._state( this._config.profile_entity || ( 'sensor.' + this._childSlug() + '_profile' ) );
		}

		_calendarId() {
			const c = this._config.calendar_entity;
			if ( c === false || c === 'none' || c === '' ) {
				return '';
			}
			return c || ( 'calendar.' + this._childSlug() + '_events' );
		}

		_childName() {
			if ( this._config.child_name ) {
				return this._config.child_name;
			}
			const profile = this._profile();
			if ( profile && profile.state && profile.state !== 'unknown' && profile.state !== 'unavailable' ) {
				return profile.state;
			}
			const growth = this._state( this._config.growth_entity );
			const friendly = growth && growth.attributes && growth.attributes.friendly_name;
			if ( friendly ) {
				return String( friendly ).replace( /\s+growth$/i, '' ).trim() || friendly;
			}
			return this._childSlug().replace( /_/g, ' ' ).replace( /\b\w/g, ( c ) => c.toUpperCase() );
		}

		_birth() {
			if ( this._config.birth_date ) {
				return parseWhen( this._config.birth_date );
			}
			const profile = this._profile();
			const birthday = profile && profile.attributes && ( profile.attributes.birthday || profile.attributes.birthdate || profile.attributes.birth_date );
			return parseWhen( birthday );
		}

		_sex() {
			if ( this._config.sex ) {
				return sexFrom( this._config.sex );
			}
			const profile = this._profile();
			return sexFrom( profile && profile.attributes && ( profile.attributes.gender || profile.attributes.sex ) );
		}

		/** All entries: fixtures, the calendar's events, the sensor's latest. */
		_series( birth ) {
			const entries = [];
			if ( Array.isArray( this._config.events ) ) {
				for ( const item of this._config.events ) {
					entries.push( parseFixtureEvent( item ) );
				}
			}
			for ( const ev of this._events ) {
				entries.push( parseGrowthEvent( ev ) );
			}
			entries.push( sensorLatest( this._state( this._config.growth_entity ) ) );
			return seriesFrom( entries, birth );
		}

		/** The display unit of a measure: forced by `units`, else the latest measurement's own. */
		_unitFor( measure, list ) {
			const ms = MEASURES.find( ( m ) => m.id === measure );
			if ( this._config.units === 'metric' ) {
				return ms.metric;
			}
			if ( this._config.units === 'imperial' ) {
				return ms.imperial;
			}
			const last = list && list[ list.length - 1 ];
			return last && last.unit ? last.unit : ms.metric;
		}

		/* ---- the calendar ---------------------------------------------------------------- */

		_fetchKey() {
			const growth = this._state( this._config.growth_entity );
			return [ this._calendarId(), this._birth(), growth ? growth.state : '' ].join( '|' );
		}

		_maybeFetch() {
			const id = this._calendarId();
			if ( ! id || ! this._hass || ! this._hass.callApi ) {
				return;
			}
			const key = this._fetchKey();
			if ( key === this._fetchedKey && Date.now() - this._fetchedAt < REFRESH_MS ) {
				return;
			}
			if ( ! this._state( id ) ) {
				// Not in hass.states: nothing to ask, say so once.
				this._fetchedKey = key;
				this._fetchedAt = Date.now();
				this._events = [];
				this._eventsError = id + ' was not found. Set calendar_entity to the child\'s Huckleberry calendar.';
				return;
			}
			this._fetchedKey = key;
			this._fetchedAt = Date.now();
			this._fetchEvents( id, key );
		}

		async _fetchEvents( id, key ) {
			const birth = this._birth();
			const start = new Date( Number.isFinite( birth ) ? birth - 86400000 : Date.now() - 2 * 366 * 86400000 );
			const end = new Date( Date.now() + 86400000 );
			this._loading = true;
			this._renderMessages();
			try {
				const events = await this._hass.callApi( 'GET', 'calendars/' + encodeURIComponent( id )
					+ '?start=' + encodeURIComponent( start.toISOString() ) + '&end=' + encodeURIComponent( end.toISOString() ) );
				if ( this._fetchedKey !== key ) {
					return;
				}
				this._events = Array.isArray( events ) ? events : [];
				this._eventsError = '';
			} catch ( err ) {
				if ( this._fetchedKey !== key ) {
					return;
				}
				this._events = [];
				this._eventsError = 'Could not read ' + id + ': ' + errorText( err, 'unknown error' );
			} finally {
				if ( this._fetchedKey === key ) {
					this._loading = false;
				}
			}
			this._render();
		}

		/* ---- rendering ------------------------------------------------------------------- */

		_render() {
			const root = this.shadowRoot;
			if ( ! this._built ) {
				root.innerHTML = `
					<style>${ STYLE }</style>
					<ha-card>
						<div class="head">
							<div class="title"></div>
							<div class="sub"></div>
						</div>
						<div class="tiles" role="tablist" aria-label="Measure"></div>
						<div class="chart"></div>
						<div class="caption"></div>
						<div class="message"></div>
					</ha-card>
				`;
				this._el = {
					title: root.querySelector( '.title' ),
					sub: root.querySelector( '.sub' ),
					tiles: root.querySelector( '.tiles' ),
					chart: root.querySelector( '.chart' ),
					caption: root.querySelector( '.caption' ),
					message: root.querySelector( '.message' ),
				};
				for ( const ms of MEASURES ) {
					const b = document.createElement( 'button' );
					b.type = 'button';
					b.className = 'tile';
					b.setAttribute( 'role', 'tab' );
					b.dataset.measure = ms.id;
					b.innerHTML = '<span class="l">' + ms.label + '</span><span class="v">—</span><span class="p"></span>';
					b.addEventListener( 'click', () => {
						this._measure = ms.id;
						this._selected = -1;
						this._render();
					} );
					this._el.tiles.appendChild( b );
				}
				this._el.chart.addEventListener( 'click', ( ev ) => this._tapPoint( ev ) );
				this._el.chart.addEventListener( 'keydown', ( ev ) => {
					if ( ev.key === 'Enter' || ev.key === ' ' ) {
						this._tapPoint( ev );
						ev.preventDefault();
					}
				} );
				this._built = true;
			}
			const birth = this._birth();
			const now = Date.now();
			const sex = this._sex();
			this._data = { birth, sex, series: this._series( birth ), todayMonths: Number.isFinite( birth ) ? ageMonths( birth, now ) : NaN };
			this._el.title.textContent = this._childName();
			const age = ageText( birth, now );
			this._el.sub.textContent = [ age, sex === 'boy' ? 'boy' : 'girl', 'WHO percentiles' ].filter( Boolean ).join( ' · ' );
			for ( const b of this._el.tiles.querySelectorAll( '.tile' ) ) {
				const id = b.dataset.measure;
				const list = this._data.series[ id ];
				const last = list[ list.length - 1 ];
				const unit = this._unitFor( id, list );
				b.setAttribute( 'aria-selected', String( id === this._measure ) );
				b.querySelector( '.v' ).textContent = last ? formatValue( last.metric, unit ) : '—';
				const pct = last ? ordinal( percentileOf( id, sex, last.months, last.metric ) ) : '';
				b.querySelector( '.p' ).textContent = pct ? pct + ' percentile' : ( last ? 'no percentile' : 'no measurement' );
			}
			this._renderChart();
			this._renderMessages();
		}

		_renderChart() {
			if ( ! this._el || ! this._data ) {
				return;
			}
			const { birth, sex, series, todayMonths } = this._data;
			const list = series[ this._measure ];
			const unit = this._unitFor( this._measure, list );
			if ( ! Number.isFinite( birth ) ) {
				this._el.chart.innerHTML = '';
				this._el.caption.innerHTML = '';
				return;
			}
			const span = this._config.months ? Math.min( MAX_MONTHS, Math.max( 1, Number( this._config.months ) ) ) : defaultSpan( todayMonths );
			const width = this._width || this.clientWidth || ( this.getBoundingClientRect && this.getBoundingClientRect().width ) || 320;
			const chartWidth = Math.max( 240, width - 32 );
			const colors = this._colors();
			if ( this._selected >= list.length ) {
				this._selected = -1;
			}
			this._el.chart.innerHTML = chartSvg( { measure: this._measure, sex, unit, span, points: list, width: chartWidth, todayMonths, selected: this._selected, colors } );
			const picked = this._selected >= 0 ? list[ this._selected ] : list[ list.length - 1 ];
			if ( picked ) {
				const pct = ordinal( percentileOf( this._measure, sex, picked.months, picked.metric ) );
				const locale = this._hass && this._hass.locale && this._hass.locale.language;
				this._el.caption.innerHTML = '<span>' + escapeHtml( this._selected >= 0 ? dateText( picked.time, locale ) : 'Latest · ' + dateText( picked.time, locale ) ) + '</span>'
					+ '<span><b>' + escapeHtml( formatValue( picked.metric, unit ) ) + '</b>' + ( pct ? ' · ' + escapeHtml( pct ) + ' percentile' : ' · beyond the 0–24 month tables' ) + '</span>';
			} else {
				this._el.caption.innerHTML = '<span>No ' + MEASURES.find( ( m ) => m.id === this._measure ).label.toLowerCase() + ' measurements yet.</span>';
			}
		}

		_colors() {
			const style = typeof getComputedStyle === 'function' ? getComputedStyle( this ) : null;
			const get = ( name, fallback ) => {
				const v = style ? style.getPropertyValue( name ).trim() : '';
				return v || fallback;
			};
			return {
				accent: get( '--primary-color', '#03a9f4' ),
				band: get( '--primary-color', '#03a9f4' ),
				curve: get( '--secondary-text-color', '#727272' ),
				grid: get( '--divider-color', 'rgba(0,0,0,0.12)' ),
				text: get( '--secondary-text-color', '#727272' ),
				bg: get( '--card-background-color', '#fff' ),
			};
		}

		_tapPoint( ev ) {
			const g = ev.target && ev.target.closest ? ev.target.closest( '.pt' ) : null;
			if ( ! g ) {
				return;
			}
			const i = Number( g.dataset.index );
			this._selected = this._selected === i ? -1 : i;
			this._renderChart();
		}

		_renderMessages() {
			if ( ! this._el || ! this._data ) {
				return;
			}
			const parts = [];
			if ( ! Number.isFinite( this._data.birth ) ) {
				const profile = this._config.profile_entity || ( 'sensor.' + this._childSlug() + '_profile' );
				parts.push( '<div class="warn">No birth date: ' + escapeHtml( profile ) + ' has no birthday attribute. Set birth_date (YYYY-MM-DD) to plot against age.</div>' );
			} else if ( this._data.todayMonths > MAX_MONTHS ) {
				parts.push( '<div class="note">The WHO tables here cover 0–24 months; later measurements have no percentile.</div>' );
			}
			if ( this._loading && ! this._events.length ) {
				parts.push( '<div class="note">Reading measurements from the calendar…</div>' );
			}
			if ( this._eventsError ) {
				parts.push( '<div class="warn">' + escapeHtml( this._eventsError ) + '</div>' );
			}
			if ( ! this._state( this._config.growth_entity ) ) {
				parts.push( '<div class="warn">' + escapeHtml( this._config.growth_entity ) + ' was not found.</div>' );
			}
			this._el.message.innerHTML = parts.join( '' );
		}
	}

	/* ---- A small config editor for the card picker -------------------------------------- */

	class HuckleberryGrowthCardEditor extends HTMLElement {
		setConfig( config ) {
			this._config = { ...config };
			this._render();
		}

		set hass( hass ) {
			this._hass = hass;
			this._render();
		}

		_render() {
			if ( ! this._config ) {
				return;
			}
			if ( ! this._form ) {
				this.innerHTML = '<ha-form></ha-form>';
				this._form = this.querySelector( 'ha-form' );
				this._form.computeLabel = ( s ) => LABELS[ s.name ] || s.name;
				this._form.computeHelper = ( s ) => HELPERS[ s.name ] || '';
				this._form.addEventListener( 'value-changed', ( ev ) => {
					ev.stopPropagation();
					const value = { ...ev.detail.value };
					for ( const k of Object.keys( value ) ) {
						if ( value[ k ] === '' || value[ k ] === null || value[ k ] === undefined ) {
							delete value[ k ];
						}
					}
					this._config = { type: 'custom:' + CARD, ...value };
					this.dispatchEvent( new CustomEvent( 'config-changed', { detail: { config: this._config }, bubbles: true, composed: true } ) );
				} );
			}
			this._form.hass = this._hass;
			this._form.schema = SCHEMA;
			this._form.data = this._config;
		}
	}

	const SCHEMA = [
		{ name: 'growth_entity', required: true, selector: { entity: { domain: 'sensor' } } },
		{ name: 'calendar_entity', selector: { entity: { domain: 'calendar' } } },
		{ name: 'profile_entity', selector: { entity: { domain: 'sensor' } } },
		{ name: 'child_name', selector: { text: {} } },
		{ name: 'birth_date', selector: { date: {} } },
		{ name: 'sex', selector: { select: { mode: 'dropdown', options: [ { value: 'girl', label: 'Girl' }, { value: 'boy', label: 'Boy' } ] } } },
		{ name: 'units', selector: { select: { mode: 'dropdown', options: [ { value: 'metric', label: 'Metric (kg, cm)' }, { value: 'imperial', label: 'Imperial (lb, in)' } ] } } },
		{ name: 'measure', selector: { select: { mode: 'dropdown', options: MEASURES.map( ( m ) => ( { value: m.id, label: m.label } ) ) } } },
		{ name: 'months', selector: { number: { min: 1, max: MAX_MONTHS, mode: 'box' } } },
	];
	const LABELS = {
		growth_entity: 'Growth sensor',
		calendar_entity: 'Huckleberry calendar',
		profile_entity: 'Profile sensor',
		child_name: 'Child\'s name',
		birth_date: 'Birth date',
		sex: 'Sex (which WHO curves)',
		units: 'Units',
		measure: 'Measure shown first',
		months: 'Months on the x-axis',
	};
	const HELPERS = {
		growth_entity: 'The child\'s growth sensor from the Huckleberry integration, sensor.<child>_growth.',
		calendar_entity: 'Default: calendar.<child>_events. Every past measurement is read from its growth events.',
		profile_entity: 'Default: sensor.<child>_profile. Gives the name, birth date and sex.',
		child_name: 'Shown as the title. Default: the profile\'s name.',
		birth_date: 'Default: the profile\'s birthday.',
		sex: 'Default: the profile\'s gender, else girl.',
		units: 'Default: the unit each measurement was logged in.',
		months: 'Default: the child\'s age, rounded up (at most 24).',
	};

	if ( ! customElements.get( CARD ) ) {
		customElements.define( CARD, HuckleberryGrowthCard );
	}
	if ( ! customElements.get( EDITOR ) ) {
		customElements.define( EDITOR, HuckleberryGrowthCardEditor );
	}
	window.customCards = window.customCards || [];
	if ( ! window.customCards.some( ( c ) => c.type === CARD ) ) {
		window.customCards.push( {
			type: CARD,
			name: 'Huckleberry growth card',
			description: 'Weight, length and head circumference from Huckleberry against the WHO percentile curves.',
			preview: false,
			documentationURL: 'https://github.com/trevorbicewebdesign/huckleberry-dashboard',
		} );
	}

	// For tests (Node/jsdom): the pure logic, without touching the page.
	const logic = {
		MEASURES, PERCENTILES, WHO, MAX_MONTHS,
		parseMeasurement, toMetric, fromMetric, parseWhen, parseGrowthEvent, sensorLatest, parseFixtureEvent,
		ageMonths, seriesFrom, lmsAt, zScore, valueAtZ, normalCdf, percentileOf, ordinal, sexFrom, defaultSpan,
		niceTicks, formatValue, ageText, chartSvg, errorText,
	};
	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = logic;
	}
	window.__huckleberryGrowthCardLogic = logic;
} )();
