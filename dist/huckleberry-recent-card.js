/**
 * Huckleberry recent card — a Home Assistant custom card.
 *
 * A newest-first list of the child's recent events (diapers, bottles, solids, sleeps, growth)
 * from Huckleberry (Woyken's integration), grouped by day. The last days come from Home
 * Assistant's own recorder (the history of the child's sensors), so the card loads at once and
 * never asks Huckleberry; "Load older" reads earlier months from the child's calendar, which
 * does. One file, no build step.
 *
 * Config (YAML):
 *   type: custom:huckleberry-recent-card
 *   child: <slug>                              # the entities' middle part: sensor.<slug>_diaper …
 *   diaper_entity: sensor.<child>_diaper       # or name each entity (any one is enough)
 *   bottle_entity: sensor.<child>_bottle
 *   solids_entity: sensor.<child>_solids
 *   sleep_entity: sensor.<child>_sleep
 *   growth_entity: sensor.<child>_growth
 *   calendar_entity: calendar.<child>_events   # for "Load older"; none turns it off
 *   days: 7                                    # how many days the recorder is asked for
 *   title: <name>                              # default: the child's name from a sensor
 *
 * The card keeps a global here only to register with the card picker.
 */
( () => {
	'use strict';

	const CARD = 'huckleberry-recent-card';
	const EDITOR = 'huckleberry-recent-card-editor';

	const KINDS = {
		diaper: { label: 'Diaper', icon: 'mdi:baby' },
		bottle: { label: 'Bottle', icon: 'mdi:baby-bottle' },
		solids: { label: 'Solids', icon: 'mdi:food-apple' },
		sleep: { label: 'Sleep', icon: 'mdi:sleep' },
		growth: { label: 'Growth', icon: 'mdi:human-male-height' },
		nursing: { label: 'Nursing', icon: 'mdi:mother-nurse' },
		potty: { label: 'Potty', icon: 'mdi:toilet' },
		other: { label: '', icon: 'mdi:calendar-blank' },
	};
	const SENSOR_KINDS = [ 'diaper', 'bottle', 'solids', 'sleep', 'growth' ];
	const DEFAULT_DAYS = 7;
	const SAME_EVENT_MS = 60 * 1000;
	const MONTH_MS = 31 * 86400000;

	/* ---- Pure logic (also what tests/check-recent.js exercises) -------------------------- */

	/** A time (ms) from an ISO string, "YYYY-MM-DD", or epoch seconds/ms; NaN otherwise. */
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

	/** The entity ids from `child` and the explicit keys; any key may be missing. */
	function entitiesFrom( config ) {
		const c = config || {};
		const slug = c.child ? String( c.child ).trim().toLowerCase().replace( /[^a-z0-9_]+/g, '_' ) : '';
		const pick = ( key, domain, suffix ) => {
			const given = c[ key + '_entity' ];
			if ( given === 'none' || given === false || given === '' ) {
				return '';
			}
			return given || ( slug ? domain + '.' + slug + '_' + suffix : '' );
		};
		return {
			diaper: pick( 'diaper', 'sensor', 'diaper' ),
			bottle: pick( 'bottle', 'sensor', 'bottle' ),
			solids: pick( 'solids', 'sensor', 'solids' ),
			sleep: pick( 'sleep', 'sensor', 'sleep' ),
			growth: pick( 'growth', 'sensor', 'growth' ),
			calendar: pick( 'calendar', 'calendar', 'events' ),
		};
	}

	/**
	 * History rows in one shape, from the websocket's compressed rows ({ s, a, lu, lc }) or the
	 * REST API's ({ state, attributes, last_updated }): [ { state, attributes, updated } ], with
	 * attributes carried forward when a row has none.
	 */
	function historyRows( rows ) {
		const out = [];
		let last = {};
		for ( const r of Array.isArray( rows ) ? rows : [] ) {
			if ( ! r || typeof r !== 'object' ) {
				continue;
			}
			const state = r.s !== undefined ? r.s : r.state;
			const attributes = r.a !== undefined ? r.a : r.attributes;
			if ( attributes && typeof attributes === 'object' ) {
				last = attributes;
			}
			const updated = r.lu !== undefined ? parseWhen( r.lu ) : parseWhen( r.last_updated || r.last_changed );
			out.push( { state: state == null ? '' : String( state ), attributes: last, updated } );
		}
		return out;
	}

	/** Huckleberry's type words as shown: "Breast_Milk" → "Breast milk", "both" → "Mixed". */
	function word( s ) {
		const t = String( s || '' ).replace( /_/g, ' ' ).trim().toLowerCase();
		if ( ! t ) {
			return '';
		}
		if ( t === 'both' ) {
			return 'Mixed';
		}
		return t.charAt( 0 ).toUpperCase() + t.slice( 1 );
	}

	function amountWord( s ) {
		const t = String( s || '' ).trim().toLowerCase();
		return { little: 'small', medium: 'medium', big: 'large' }[ t ] || t;
	}

	/**
	 * Events from one sensor's history. The timestamp sensors (diaper, bottle, solids, growth)
	 * hold the last event's time as their state, so every distinct state is one event, with the
	 * attributes of that row. The sleep sensor's previous_start / previous_duration pair is a
	 * finished sleep. Rows before `since` (the window's first state) are left out.
	 */
	function eventsFromHistory( kind, rows, since ) {
		const out = [];
		const seen = new Set();
		for ( const row of historyRows( rows ) ) {
			const a = row.attributes || {};
			if ( kind === 'sleep' ) {
				const start = parseWhen( a.previous_start );
				if ( ! Number.isFinite( start ) || seen.has( start ) ) {
					continue;
				}
				seen.add( start );
				if ( Number.isFinite( since ) && start < since ) {
					continue;
				}
				out.push( { kind, time: start, duration: parseDuration( a.previous_duration ), note: a.previous_notes ? String( a.previous_notes ) : '' } );
				continue;
			}
			if ( ! row.state || row.state === 'unknown' || row.state === 'unavailable' ) {
				continue;
			}
			const time = parseWhen( a.time || row.state );
			if ( ! Number.isFinite( time ) || seen.has( time ) ) {
				continue;
			}
			seen.add( time );
			if ( Number.isFinite( since ) && time < since ) {
				continue;
			}
			out.push( eventFromAttributes( kind, time, a ) );
		}
		return out;
	}

	/** One event of a timestamp sensor from its attributes at that time. */
	function eventFromAttributes( kind, time, a ) {
		const ev = { kind, time };
		if ( kind === 'diaper' ) {
			ev.type = word( a.type );
			ev.pee = amountWord( a.pee_amount );
			ev.poo = amountWord( a.poo_amount );
			ev.rash = a.diaper_rash === true;
		} else if ( kind === 'bottle' ) {
			ev.amount = a.amount == null || a.amount === '' ? NaN : Number( a.amount );
			ev.units = a.units ? String( a.units ) : '';
			ev.type = word( a.type );
		} else if ( kind === 'solids' ) {
			ev.foods = Array.isArray( a.foods ) ? a.foods.map( String ) : ( a.foods ? [ String( a.foods ) ] : [] );
			ev.reaction = a.reaction ? word( a.reaction ) : '';
			ev.note = a.notes ? String( a.notes ) : '';
		} else if ( kind === 'growth' ) {
			ev.weight = measure( a.weight, a.weight_unit );
			ev.height = measure( a.height, a.height_unit );
			ev.head = measure( a.head_circumference, a.head_unit );
		}
		return ev;
	}

	function measure( value, unit ) {
		if ( value == null || value === '' || ! Number.isFinite( Number( value ) ) ) {
			return '';
		}
		const u = { 'lbs.oz': 'lb', 'ft.in': 'in', hcm: 'cm', hin: 'in' }[ String( unit || '' ) ] || String( unit || '' );
		return String( Math.round( Number( value ) * 100 ) / 100 ) + ( u ? ' ' + u : '' );
	}

	/** Milliseconds from "1h 20m", "80 min 5 sec", "45 sec", "1:20:00" or an ISO 8601 duration. */
	function parseDuration( value ) {
		if ( value == null || value === '' ) {
			return NaN;
		}
		if ( typeof value === 'number' ) {
			return value * 1000;
		}
		const s = String( value ).trim();
		const iso = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec( s );
		if ( iso ) {
			return ( ( Number( iso[ 1 ] || 0 ) * 24 + Number( iso[ 2 ] || 0 ) ) * 3600 + Number( iso[ 3 ] || 0 ) * 60 + Number( iso[ 4 ] || 0 ) ) * 1000;
		}
		const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec( s );
		if ( clock ) {
			return ( Number( clock[ 1 ] ) * 3600 + Number( clock[ 2 ] ) * 60 + Number( clock[ 3 ] || 0 ) ) * 1000;
		}
		let ms = 0;
		let found = false;
		const re = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/gi;
		let m;
		while ( ( m = re.exec( s ) ) ) {
			found = true;
			const n = Number( m[ 1 ] );
			const u = m[ 2 ].toLowerCase();
			ms += u.startsWith( 'h' ) ? n * 3600000 : u.startsWith( 'm' ) ? n * 60000 : n * 1000;
		}
		return found ? ms : NaN;
	}

	/**
	 * An event from one of the integration's calendar events ({ start, end, summary,
	 * description }). Summaries: "💧 Diaper (Pee)", "🍼 Bottle (4 oz)", "🍼 Feed (L:10m R:5m)",
	 * "🥄 Solids (Banana)", "💤 Sleep (1h 20m)", "📏 Growth Measurement", "🚽 Potty (…)"; the
	 * description's lines carry the rest ("Pee amount: medium", "Type: formula", "Notes: …").
	 */
	function eventFromCalendar( ev ) {
		if ( ! ev || typeof ev !== 'object' ) {
			return null;
		}
		const startRaw = ev.start && typeof ev.start === 'object' ? ( ev.start.dateTime || ev.start.date ) : ev.start;
		const endRaw = ev.end && typeof ev.end === 'object' ? ( ev.end.dateTime || ev.end.date ) : ev.end;
		const time = parseWhen( startRaw );
		if ( ! Number.isFinite( time ) ) {
			return null;
		}
		const end = parseWhen( endRaw );
		const summary = String( ev.summary || '' ).trim();
		const text = summary.replace( /^[^A-Za-z]+/, '' ); // the emoji off
		const lines = {};
		for ( const line of String( ev.description || '' ).split( /\r?\n/ ) ) {
			const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec( line );
			if ( m ) {
				lines[ m[ 1 ].toLowerCase() ] = m[ 2 ].trim();
			}
		}
		// "Solids (Banana, Rice (2 tbsp))": the head is the text before the first "(", the
		// inside everything up to the last ")".
		const open = text.indexOf( '(' );
		const close = text.lastIndexOf( ')' );
		const inside = open >= 0 && close > open ? text.slice( open + 1, close ).trim() : '';
		const headText = ( open >= 0 ? text.slice( 0, open ) : text ).trim();
		const head = headText.toLowerCase();
		const note = lines.notes || '';
		if ( head === 'diaper' ) {
			const mode = ( lines.diaper || inside ).split( ',' )[ 0 ];
			return { kind: 'diaper', time, type: word( mode ), pee: amountWord( lines[ 'pee amount' ] ), poo: amountWord( lines[ 'poo amount' ] ), rash: /yes/i.test( lines[ 'diaper rash' ] || '' ), note };
		}
		if ( head === 'potty' ) {
			return { kind: 'potty', time, type: word( ( lines.potty || inside ).split( ',' )[ 0 ] ), how: lines[ 'how it happened' ] || '', note };
		}
		if ( head === 'bottle' ) {
			const amount = /(\d+(?:\.\d+)?)\s*([a-z]+)?/i.exec( lines[ 'bottle feeding' ] || inside || '' );
			return { kind: 'bottle', time, amount: amount ? Number( amount[ 1 ] ) : NaN, units: amount && amount[ 2 ] ? amount[ 2 ] : '', type: word( lines.type ), note };
		}
		if ( head === 'feed' ) {
			return { kind: 'nursing', time, duration: Number.isFinite( end ) && end > time ? end - time : parseDuration( ( lines[ 'feeding - total' ] || '' ) ), left: lines.left || '', right: lines.right || '', note };
		}
		if ( head === 'solids' ) {
			const foods = ( lines.foods || inside ).split( ',' ).map( ( f ) => f.trim() ).filter( Boolean );
			return { kind: 'solids', time, foods, reaction: lines.reaction ? word( lines.reaction ) : '', note };
		}
		if ( head === 'sleep' ) {
			const fromText = parseDuration( lines[ 'sleep duration' ] || inside );
			return { kind: 'sleep', time, duration: Number.isFinite( end ) && end > time ? end - time : fromText, note };
		}
		if ( /^growth/.test( head ) ) {
			return { kind: 'growth', time, weight: lines.weight || '', height: lines.height || '', head: lines.head || '', note };
		}
		return { kind: 'other', time, label: headText || summary || 'Event', detail: inside, note };
	}

	/** "1 h 20 min", "45 min", "30 s". */
	function durationText( ms ) {
		if ( ! Number.isFinite( ms ) || ms < 0 ) {
			return '';
		}
		const s = Math.round( ms / 1000 );
		if ( s < 60 ) {
			return s + ' s';
		}
		const m = Math.floor( s / 60 );
		if ( m < 60 ) {
			return m + ' min';
		}
		const h = Math.floor( m / 60 );
		const rem = m % 60;
		return rem ? h + ' h ' + rem + ' min' : h + ' h';
	}

	/** The one-line detail of an event. */
	function detailText( ev ) {
		if ( ! ev ) {
			return '';
		}
		const parts = [];
		switch ( ev.kind ) {
			case 'diaper': {
				parts.push( ev.type || 'Change' );
				if ( ev.type === 'Mixed' ) {
					const sizes = [ ev.pee ? 'pee ' + ev.pee : '', ev.poo ? 'poo ' + ev.poo : '' ].filter( Boolean );
					if ( sizes.length ) {
						parts.push( sizes.join( ', ' ) );
					}
				} else if ( ev.pee || ev.poo ) {
					parts.push( ev.pee || ev.poo );
				}
				if ( ev.rash ) {
					parts.push( 'rash' );
				}
				break;
			}
			case 'bottle': {
				const amount = Number.isFinite( ev.amount ) ? String( Math.round( ev.amount * 100 ) / 100 ) + ( ev.units ? ' ' + ev.units : '' ) : '';
				parts.push( [ amount, ev.type ? ev.type.toLowerCase() : '' ].filter( Boolean ).join( ' ' ) || 'Bottle' );
				break;
			}
			case 'solids':
				parts.push( ev.foods && ev.foods.length ? ev.foods.join( ', ' ) : 'Solids' );
				if ( ev.reaction ) {
					parts.push( ev.reaction.toLowerCase() );
				}
				break;
			case 'sleep':
				if ( ev.ongoing ) {
					parts.push( ev.status === 'paused' ? 'paused' : 'sleeping' );
				}
				parts.push( durationText( ev.duration ) || ( ev.ongoing ? '' : 'logged' ) );
				break;
			case 'nursing':
				parts.push( durationText( ev.duration ) || 'Feed' );
				if ( ev.left || ev.right ) {
					parts.push( [ ev.left ? 'L ' + ev.left : '', ev.right ? 'R ' + ev.right : '' ].filter( Boolean ).join( ', ' ) );
				}
				break;
			case 'growth':
				parts.push( [ ev.weight, ev.height, ev.head ].filter( Boolean ).join( ' · ' ) || 'Measurement' );
				break;
			case 'potty':
				parts.push( ev.type || 'Potty' );
				if ( ev.how ) {
					parts.push( ev.how.toLowerCase() );
				}
				break;
			default:
				parts.push( ev.detail || '' );
		}
		return parts.filter( Boolean ).join( ' · ' );
	}

	function kindLabel( ev ) {
		if ( ev.kind === 'other' ) {
			return ev.label || 'Event';
		}
		return ( KINDS[ ev.kind ] || KINDS.other ).label;
	}

	/** Newest first; two events of one kind within a minute are the same event (the newer list wins). */
	function mergeEvents( existing, incoming ) {
		const all = [ ...( incoming || [] ).filter( Boolean ), ...( existing || [] ).filter( Boolean ) ];
		const kept = [];
		for ( const ev of all ) {
			if ( ! Number.isFinite( ev.time ) ) {
				continue;
			}
			if ( kept.some( ( k ) => k.kind === ev.kind && Math.abs( k.time - ev.time ) < SAME_EVENT_MS ) ) {
				continue;
			}
			kept.push( ev );
		}
		return kept.sort( ( a, b ) => b.time - a.time );
	}

	/** "Today", "Yesterday", else "Mon, Oct 20" (with the year when it differs). */
	function dayLabel( time, now, locale ) {
		const d = new Date( time );
		const n = new Date( now || Date.now() );
		const day = ( x ) => new Date( x.getFullYear(), x.getMonth(), x.getDate() ).getTime();
		const diff = Math.round( ( day( n ) - day( d ) ) / 86400000 );
		if ( diff === 0 ) {
			return 'Today';
		}
		if ( diff === 1 ) {
			return 'Yesterday';
		}
		try {
			return d.toLocaleDateString( locale || undefined, { weekday: 'short', month: 'short', day: 'numeric', ...( d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {} ) } );
		} catch {
			return d.toDateString();
		}
	}

	/** [ { label, day, events } ] newest day first, events newest first within. */
	function groupByDay( events, now, locale ) {
		const groups = [];
		for ( const ev of mergeEvents( [], events ) ) {
			const d = new Date( ev.time );
			const day = new Date( d.getFullYear(), d.getMonth(), d.getDate() ).getTime();
			let g = groups[ groups.length - 1 ];
			if ( ! g || g.day !== day ) {
				g = { day, label: dayLabel( ev.time, now, locale ), events: [] };
				groups.push( g );
			}
			g.events.push( ev );
		}
		return groups;
	}

	/** The running sleep from the live sleep sensor, as an event at the top, or null. */
	function ongoingSleep( state ) {
		if ( ! state ) {
			return null;
		}
		const s = String( state.state || '' ).toLowerCase();
		if ( s !== 'active' && s !== 'paused' ) {
			return null;
		}
		const a = state.attributes || {};
		const start = parseWhen( a.current_start );
		if ( ! Number.isFinite( start ) ) {
			return null;
		}
		const end = s === 'paused' ? parseWhen( a.current_end ) : NaN;
		return { kind: 'sleep', time: start, ongoing: true, status: s, duration: ( Number.isFinite( end ) ? end : Date.now() ) - start };
	}

	/** Words for an error from hass.callWS / callApi. */
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
		if ( err.error && err.error.message ) {
			return String( err.error.message );
		}
		return fallback;
	}

	function clock( ms, locale ) {
		if ( ! Number.isFinite( ms ) ) {
			return '';
		}
		try {
			return new Date( ms ).toLocaleTimeString( locale || undefined, { hour: 'numeric', minute: '2-digit' } );
		} catch {
			return new Date( ms ).toTimeString().slice( 0, 5 );
		}
	}

	function dateText( ms, locale ) {
		try {
			return new Date( ms ).toLocaleDateString( locale || undefined, { year: 'numeric', month: 'short', day: 'numeric' } );
		} catch {
			return new Date( ms ).toDateString();
		}
	}

	/* ---- The card ------------------------------------------------------------------------- */

	const STYLE = `
		:host { display: block; }
		ha-card { padding: 16px; box-sizing: border-box; }
		.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
		.title { font-size: 1.25rem; font-weight: 500; color: var(--primary-text-color); line-height: 1.3; }
		.sub { font-size: 0.875rem; color: var(--secondary-text-color); text-align: right; line-height: 1.3; }
		.day { font-size: 0.8125rem; font-weight: 500; color: var(--secondary-text-color); letter-spacing: 0.02em; margin: 14px 0 2px; padding-bottom: 4px; border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12)); }
		.ev { display: grid; grid-template-columns: 64px 28px minmax(0, 1fr); gap: 10px; align-items: center; min-height: 40px; padding: 4px 0; }
		.ev .time { font-size: 0.875rem; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
		.ev ha-icon { --mdc-icon-size: 22px; color: var(--primary-color); }
		.ev.ongoing ha-icon { animation: pulse 2s ease-in-out infinite; }
		@keyframes pulse { 50% { opacity: 0.4; } }
		.ev .what { font-size: 0.9375rem; color: var(--primary-text-color); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.ev .what b { font-weight: 500; }
		.ev .what .d { color: var(--secondary-text-color); }
		.ev .what .n { color: var(--secondary-text-color); font-style: italic; }
		.empty { color: var(--secondary-text-color); font-size: 0.9375rem; padding: 12px 0; }
		.more {
			appearance: none; -webkit-appearance: none; font: inherit; cursor: pointer; margin: 14px 0 0;
			width: 100%; min-height: 48px; border-radius: 12px; border: 1px solid var(--primary-color);
			background: transparent; color: var(--primary-color); font-weight: 500;
			display: flex; align-items: center; justify-content: center; gap: 8px;
		}
		.more:disabled { opacity: 0.45; cursor: default; }
		.more:focus-visible { outline: 2px solid var(--primary-text-color); outline-offset: 2px; }
		.hint { font-size: 0.8125rem; color: var(--secondary-text-color); margin-top: 6px; text-align: center; }
		.warn {
			margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 0.875rem; line-height: 1.4;
			border: 1px solid var(--warning-color, #ffa600); color: var(--primary-text-color);
		}
		[hidden] { display: none !important; }
	`;

	class HuckleberryRecentCard extends HTMLElement {
		static getConfigElement() {
			return document.createElement( EDITOR );
		}

		static getStubConfig( hass ) {
			const id = hass && hass.states ? Object.keys( hass.states ).find( ( x ) => /^sensor\..*_diaper$/.test( x ) ) : undefined;
			const slug = id ? id.slice( 'sensor.'.length ).replace( /_diaper$/, '' ) : 'child';
			return { child: slug, days: DEFAULT_DAYS };
		}

		constructor() {
			super();
			this.attachShadow( { mode: 'open' } );
			this._config = null;
			this._hass = null;
			this._entities = {};
			this._recent = []; // from the recorder
			this._older = []; // from the calendar
			this._olderEnd = NaN; // the calendar has been read back to here (exclusive)
			this._loadedBackTo = NaN;
			this._loading = false;
			this._loadingOlder = false;
			this._error = '';
			this._olderError = '';
			this._fetchedKey = '';
			this._built = false;
			this._tick = null;
		}

		setConfig( config ) {
			const entities = entitiesFrom( config );
			if ( ! SENSOR_KINDS.some( ( k ) => entities[ k ] ) ) {
				throw new Error( 'Give child (the slug in sensor.<child>_diaper) or at least one of diaper_entity, bottle_entity, solids_entity, sleep_entity, growth_entity.' );
			}
			if ( config.days !== undefined && ! ( Number( config.days ) > 0 ) ) {
				throw new Error( 'days must be a number of days, such as 7.' );
			}
			this._config = { ...config };
			this._entities = entities;
			this._recent = [];
			this._older = [];
			this._olderEnd = NaN;
			this._loadedBackTo = NaN;
			this._fetchedKey = '';
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
			if ( ! this._tick ) {
				this._tick = setInterval( () => this._renderList(), 60 * 1000 );
			}
		}

		disconnectedCallback() {
			clearInterval( this._tick );
			this._tick = null;
		}

		getCardSize() {
			return 8;
		}

		getGridOptions() {
			return { columns: 12, min_columns: 6, rows: 'auto' };
		}

		/* ---- the recorder ---------------------------------------------------------------- */

		_days() {
			return Number( this._config.days ) > 0 ? Number( this._config.days ) : DEFAULT_DAYS;
		}

		_sensorIds() {
			return SENSOR_KINDS.map( ( k ) => this._entities[ k ] ).filter( ( id ) => id && this._hass && this._hass.states && this._hass.states[ id ] );
		}

		_state( id ) {
			return id && this._hass && this._hass.states ? this._hass.states[ id ] : undefined;
		}

		/** Read again when a sensor's state changes (a new event), or the config does. */
		_fetchKey() {
			return this._sensorIds().map( ( id ) => id + '=' + this._state( id ).state + '/' + ( this._state( id ).last_updated || '' ) ).join( '|' ) + '|' + this._days();
		}

		_maybeFetch() {
			if ( ! this._hass || ! this._hass.callWS ) {
				return;
			}
			const key = this._fetchKey();
			if ( key === this._fetchedKey ) {
				return;
			}
			this._fetchedKey = key;
			this._fetchRecent( key );
		}

		async _fetchRecent( key ) {
			const ids = this._sensorIds();
			const now = Date.now();
			const start = now - this._days() * 86400000;
			if ( ! Number.isFinite( this._olderEnd ) ) {
				this._olderEnd = start;
			}
			if ( ! ids.length ) {
				this._recent = [];
				this._error = 'None of the child\'s sensors were found: ' + SENSOR_KINDS.map( ( k ) => this._entities[ k ] ).filter( Boolean ).join( ', ' );
				this._renderList();
				return;
			}
			this._loading = true;
			this._error = '';
			this._renderList();
			try {
				const answer = await this._history( ids, start, now );
				if ( this._fetchedKey !== key ) {
					return;
				}
				const events = [];
				for ( const kind of SENSOR_KINDS ) {
					const id = this._entities[ kind ];
					if ( id && answer[ id ] ) {
						events.push( ...eventsFromHistory( kind, answer[ id ], start ) );
					}
				}
				this._recent = events;
			} catch ( err ) {
				if ( this._fetchedKey !== key ) {
					return;
				}
				this._recent = [];
				this._error = 'Could not read the history: ' + errorText( err, 'unknown error' );
			} finally {
				if ( this._fetchedKey === key ) {
					this._loading = false;
				}
			}
			this._renderList();
		}

		/** The recorder's history of the sensors: the websocket command, else the REST endpoint. */
		async _history( ids, start, end ) {
			try {
				const answer = await this._hass.callWS( {
					type: 'history/history_during_period',
					start_time: new Date( start ).toISOString(),
					end_time: new Date( end ).toISOString(),
					entity_ids: ids,
					include_start_time_state: true,
					significant_changes_only: false,
					minimal_response: false,
					no_attributes: false,
				} );
				if ( answer && typeof answer === 'object' ) {
					return answer;
				}
			} catch ( err ) {
				if ( ! this._hass.callApi ) {
					throw err;
				}
			}
			const list = await this._hass.callApi( 'GET', 'history/period/' + encodeURIComponent( new Date( start ).toISOString() )
				+ '?filter_entity_id=' + encodeURIComponent( ids.join( ',' ) ) + '&end_time=' + encodeURIComponent( new Date( end ).toISOString() ) );
			const out = {};
			for ( const rows of Array.isArray( list ) ? list : [] ) {
				if ( Array.isArray( rows ) && rows.length && rows[ 0 ].entity_id ) {
					out[ rows[ 0 ].entity_id ] = rows;
				}
			}
			return out;
		}

		/* ---- the calendar ---------------------------------------------------------------- */

		async _loadOlder() {
			const id = this._entities.calendar;
			if ( this._loadingOlder || ! id || ! this._hass || ! this._hass.callApi || ! Number.isFinite( this._olderEnd ) ) {
				return;
			}
			const end = this._olderEnd;
			const start = end - MONTH_MS;
			this._loadingOlder = true;
			this._olderError = '';
			this._renderMore();
			try {
				const events = await this._hass.callApi( 'GET', 'calendars/' + encodeURIComponent( id )
					+ '?start=' + encodeURIComponent( new Date( start ).toISOString() ) + '&end=' + encodeURIComponent( new Date( end ).toISOString() ) );
				const parsed = ( Array.isArray( events ) ? events : [] ).map( eventFromCalendar ).filter( ( ev ) => ev && ev.time < end );
				this._older = mergeEvents( this._older, parsed );
				this._olderEnd = start;
				this._loadedBackTo = start;
			} catch ( err ) {
				this._olderError = 'Could not read ' + id + ': ' + errorText( err, 'unknown error' );
			} finally {
				this._loadingOlder = false;
			}
			this._renderList();
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
						<div class="list"></div>
						<div class="message"></div>
						<button type="button" class="more"></button>
						<div class="hint"></div>
					</ha-card>
				`;
				this._el = {
					title: root.querySelector( '.title' ),
					sub: root.querySelector( '.sub' ),
					list: root.querySelector( '.list' ),
					message: root.querySelector( '.message' ),
					more: root.querySelector( '.more' ),
					hint: root.querySelector( '.hint' ),
				};
				this._el.more.addEventListener( 'click', () => this._loadOlder() );
				this._built = true;
			}
			this._el.title.textContent = this._config.title || this._childName();
			this._renderList();
		}

		_childName() {
			for ( const kind of SENSOR_KINDS ) {
				const st = this._state( this._entities[ kind ] );
				const friendly = st && st.attributes && st.attributes.friendly_name;
				if ( friendly ) {
					return String( friendly ).replace( new RegExp( '\\s+' + kind + '$', 'i' ), '' ).trim() || friendly;
				}
			}
			const slug = this._config.child || String( this._entities.diaper || this._entities.bottle || '' ).split( '.' )[ 1 ] || '';
			return slug.replace( /_(diaper|bottle|solids|sleep|growth)$/, '' ).replace( /_/g, ' ' ).replace( /\b\w/g, ( c ) => c.toUpperCase() ) || 'Recent';
		}

		_locale() {
			return this._hass && this._hass.locale && this._hass.locale.language;
		}

		_renderList() {
			if ( ! this._el ) {
				return;
			}
			const now = Date.now();
			const locale = this._locale();
			const live = ongoingSleep( this._state( this._entities.sleep ) );
			const events = mergeEvents( this._older, [ ...( live ? [ live ] : [] ), ...this._recent ] );
			const groups = groupByDay( events, now, locale );
			this._el.sub.textContent = this._loading && ! events.length ? 'Reading…' : 'Last ' + this._days() + ' days' + ( Number.isFinite( this._loadedBackTo ) ? ' + back to ' + dateText( this._loadedBackTo, locale ) : '' );
			const html = [];
			for ( const g of groups ) {
				html.push( '<div class="day">' + escapeHtml( g.label ) + '</div>' );
				for ( const ev of g.events ) {
					const k = KINDS[ ev.kind ] || KINDS.other;
					html.push( '<div class="ev' + ( ev.ongoing ? ' ongoing' : '' ) + '">'
						+ '<div class="time">' + escapeHtml( clock( ev.time, locale ) ) + '</div>'
						+ '<ha-icon icon="' + k.icon + '"></ha-icon>'
						+ '<div class="what"><b>' + escapeHtml( kindLabel( ev ) ) + '</b> <span class="d">' + escapeHtml( detailText( ev ) ) + '</span>'
						+ ( ev.note ? ' <span class="n">' + escapeHtml( ev.note ) + '</span>' : '' ) + '</div></div>' );
				}
			}
			if ( ! groups.length ) {
				html.push( '<div class="empty">' + ( this._loading ? 'Reading the last ' + this._days() + ' days…' : 'Nothing in the last ' + this._days() + ' days.' ) + '</div>' );
			}
			this._el.list.innerHTML = html.join( '' );
			this._el.message.innerHTML = ( this._error ? '<div class="warn">' + escapeHtml( this._error ) + '</div>' : '' )
				+ ( this._olderError ? '<div class="warn">' + escapeHtml( this._olderError ) + '</div>' : '' );
			this._renderMore();
		}

		_renderMore() {
			const id = this._entities.calendar;
			const have = !! ( id && this._state( id ) );
			this._el.more.hidden = ! id;
			this._el.more.disabled = this._loadingOlder || ! have || ! Number.isFinite( this._olderEnd );
			this._el.more.innerHTML = this._loadingOlder
				? '<ha-icon icon="mdi:timer-sand"></ha-icon><span>Asking Huckleberry…</span>'
				: '<ha-icon icon="mdi:history"></ha-icon><span>Load older</span>';
			if ( ! id ) {
				this._el.hint.textContent = '';
			} else if ( ! have ) {
				this._el.hint.textContent = id + ' was not found, so older events cannot be loaded.';
			} else if ( Number.isFinite( this._olderEnd ) ) {
				this._el.hint.textContent = 'Reads the month before ' + dateText( this._olderEnd, this._locale() ) + ' from ' + id + ' (slow: it asks Huckleberry).';
			} else {
				this._el.hint.textContent = '';
			}
		}
	}

	function escapeHtml( s ) {
		return String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );
	}

	/* ---- A small config editor for the card picker -------------------------------------- */

	class HuckleberryRecentCardEditor extends HTMLElement {
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
		{ name: 'child', selector: { text: {} } },
		{ name: 'title', selector: { text: {} } },
		{ name: 'days', selector: { number: { min: 1, max: 90, mode: 'box' } } },
		{ name: 'diaper_entity', selector: { entity: { domain: 'sensor' } } },
		{ name: 'bottle_entity', selector: { entity: { domain: 'sensor' } } },
		{ name: 'solids_entity', selector: { entity: { domain: 'sensor' } } },
		{ name: 'sleep_entity', selector: { entity: { domain: 'sensor' } } },
		{ name: 'growth_entity', selector: { entity: { domain: 'sensor' } } },
		{ name: 'calendar_entity', selector: { entity: { domain: 'calendar' } } },
	];
	const LABELS = {
		child: 'Child (entity slug)',
		title: 'Title',
		days: 'Days from the recorder',
		diaper_entity: 'Diaper sensor',
		bottle_entity: 'Bottle sensor',
		solids_entity: 'Solids sensor',
		sleep_entity: 'Sleep sensor',
		growth_entity: 'Growth sensor',
		calendar_entity: 'Huckleberry calendar',
	};
	const HELPERS = {
		child: 'The middle of the child\'s entity ids: "mia" for sensor.mia_diaper. Fills every entity below.',
		title: 'Default: the child\'s name from a sensor.',
		days: 'Default: 7. These come from Home Assistant\'s own history, so they load at once.',
		calendar_entity: 'Default: calendar.<child>_events. "Load older" reads earlier months from it.',
	};

	if ( ! customElements.get( CARD ) ) {
		customElements.define( CARD, HuckleberryRecentCard );
	}
	if ( ! customElements.get( EDITOR ) ) {
		customElements.define( EDITOR, HuckleberryRecentCardEditor );
	}
	window.customCards = window.customCards || [];
	if ( ! window.customCards.some( ( c ) => c.type === CARD ) ) {
		window.customCards.push( {
			type: CARD,
			name: 'Huckleberry recent card',
			description: 'The child\'s recent diapers, bottles, solids, sleeps and growth, newest first, by day.',
			preview: false,
			documentationURL: 'https://github.com/trevorbicewebdesign/huckleberry-dashboard',
		} );
	}

	// For tests (Node/jsdom): the pure logic, without touching the page.
	const logic = {
		KINDS, SENSOR_KINDS, DEFAULT_DAYS, parseWhen, entitiesFrom, historyRows, eventsFromHistory, eventFromAttributes, parseDuration,
		eventFromCalendar, durationText, detailText, kindLabel, mergeEvents, dayLabel, groupByDay, ongoingSleep, errorText,
	};
	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = logic;
	}
	window.__huckleberryRecentCardLogic = logic;
} )();
