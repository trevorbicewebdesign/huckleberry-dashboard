/**
 * Huckleberry feeding card — a Home Assistant custom card.
 *
 * Logs bottles in Huckleberry (Woyken's integration, action huckleberry.log_bottle) in two
 * steps, because Huckleberry cannot edit a bottle once it is logged: "Start bottle" notes what
 * was prepared, and "Finish" logs the bottle with what the child actually had. The open bottle
 * lives in Home Assistant helpers, so every phone sees the same bottle. One file, no build step.
 *
 * Config (YAML):
 *   type: custom:huckleberry-feeding-card
 *   bottle_entity: sensor.<child>_bottle       # required: the child's "last bottle" sensor
 *   child_name: <name>                         # default: from the entity's friendly name
 *   huckleberry_device_id: <device id>         # default: the device that owns bottle_entity
 *   helper_prefix: huckleberry                 # the helpers' prefix (packages/huckleberry_feeding.yaml)
 *   units: oz | ml                             # default oz
 *   default_amount: 4                          # prepared amount preselected (default 4 oz / 120 ml)
 *   step: 0.5                                  # the − / + step (default 0.5 oz / 10 ml)
 *   bottle_types: [formula, breast_milk]       # the contents offered (any of Huckleberry's types)
 *   default_type: formula                      # preselected contents (default: the first)
 *
 * Helpers (one set per household, made once from packages/huckleberry_feeding.yaml):
 *   input_datetime.<prefix>_bottle_started, input_number.<prefix>_bottle_prepared,
 *   input_number.<prefix>_bottle_had, input_select.<prefix>_bottle_type,
 *   input_text.<prefix>_bottle_note
 *
 * The card keeps a global here only to register with the card picker.
 */
( () => {
	'use strict';

	const CARD = 'huckleberry-feeding-card';
	const EDITOR = 'huckleberry-feeding-card-editor';

	// Huckleberry's bottle types, in the integration's words (log_bottle's bottle_type).
	const TYPES = [
		{ id: 'formula', label: 'Formula', icon: 'mdi:baby-bottle-outline' },
		{ id: 'breast_milk', label: 'Breast milk', icon: 'mdi:mother-nurse' },
		{ id: 'tube_feeding', label: 'Tube feeding', icon: 'mdi:pipe' },
		{ id: 'cow_milk', label: 'Cow milk', icon: 'mdi:cow' },
		{ id: 'goat_milk', label: 'Goat milk', icon: 'mdi:sheep' },
		{ id: 'soy_milk', label: 'Soy milk', icon: 'mdi:soy-sauce' },
		{ id: 'other', label: 'Other', icon: 'mdi:cup-outline' },
	];
	const DEFAULT_TYPES = [ 'formula', 'breast_milk' ];
	const UNITS = {
		oz: { label: 'oz', step: 0.5, amount: 4, max: 64, decimals: 1 },
		ml: { label: 'ml', step: 10, amount: 120, max: 2000, decimals: 0 },
	};
	const DEFAULT_PREFIX = 'huckleberry';
	const LOGGED_FOR = 2500;
	const TICK_MS = 30 * 1000;

	/* ---- Pure logic (also what tests/check-feeding.js exercises) ------------------------- */

	/** The unit's settings (step, default amount) with the config's overrides. */
	function unitSettings( config ) {
		const u = UNITS[ config && config.units === 'ml' ? 'ml' : 'oz' ];
		const step = Number( config && config.step ) > 0 ? Number( config.step ) : u.step;
		const amount = Number( config && config.default_amount ) > 0 ? Number( config.default_amount ) : u.amount;
		return { ...u, id: config && config.units === 'ml' ? 'ml' : 'oz', step, amount };
	}

	/** The helper entity ids for a prefix. */
	function helperIds( prefix ) {
		const p = String( prefix || DEFAULT_PREFIX ).trim().replace( /[^a-z0-9_]/gi, '_' ).toLowerCase() || DEFAULT_PREFIX;
		return {
			started: 'input_datetime.' + p + '_bottle_started',
			prepared: 'input_number.' + p + '_bottle_prepared',
			had: 'input_number.' + p + '_bottle_had',
			type: 'input_select.' + p + '_bottle_type',
			note: 'input_text.' + p + '_bottle_note',
		};
	}

	/** Which of the helpers are not in hass.states. */
	function missingHelpers( states, ids ) {
		return Object.keys( ids ).map( ( k ) => ids[ k ] ).filter( ( id ) => ! ( states && states[ id ] ) );
	}

	/** The time (ms) an input_datetime holds: its timestamp attribute, else its state parsed. */
	function helperTime( state ) {
		if ( ! state ) {
			return NaN;
		}
		const ts = state.attributes && state.attributes.timestamp;
		if ( Number.isFinite( Number( ts ) ) && Number( ts ) > 0 ) {
			return Number( ts ) * 1000;
		}
		const s = String( state.state || '' ).trim();
		if ( ! s || s === 'unknown' || s === 'unavailable' ) {
			return NaN;
		}
		return Date.parse( s.replace( ' ', 'T' ) );
	}

	/** The bottle the helpers hold, or null when none is open (prepared is 0 or the start is unset). */
	function openBottleFrom( states, ids ) {
		if ( ! states ) {
			return null;
		}
		const prepared = Number( states[ ids.prepared ] && states[ ids.prepared ].state );
		const started = helperTime( states[ ids.started ] );
		if ( ! ( prepared > 0 ) || ! Number.isFinite( started ) || started < 946684800000 ) {
			return null;
		}
		const had = Number( states[ ids.had ] && states[ ids.had ].state );
		const type = states[ ids.type ] ? String( states[ ids.type ].state ) : '';
		const note = states[ ids.note ] ? String( states[ ids.note ].state ) : '';
		return {
			started,
			prepared,
			had: had > 0 ? had : prepared,
			hadEntered: had > 0,
			type: TYPES.some( ( t ) => t.id === type ) ? type : 'other',
			note: note === 'unknown' ? '' : note,
		};
	}

	/** "2026-10-27T13:05:00-07:00": a time with the browser's UTC offset, as HA's datetime fields read it. */
	function isoWithOffset( ms ) {
		const d = new Date( ms );
		const pad = ( n ) => String( Math.abs( n ) ).padStart( 2, '0' );
		const off = -d.getTimezoneOffset();
		const sign = off >= 0 ? '+' : '-';
		return d.getFullYear() + '-' + pad( d.getMonth() + 1 ) + '-' + pad( d.getDate() )
			+ 'T' + pad( d.getHours() ) + ':' + pad( d.getMinutes() ) + ':' + pad( d.getSeconds() )
			+ sign + pad( Math.floor( Math.abs( off ) / 60 ) ) + ':' + pad( Math.abs( off ) % 60 );
	}

	/** The huckleberry.log_bottle call for an open bottle: the amount had (prepared when none entered). */
	function logBottleCall( bottle, deviceId, units ) {
		if ( ! bottle || ! ( bottle.prepared > 0 ) ) {
			throw new Error( 'No bottle is open.' );
		}
		const amount = bottle.had > 0 ? bottle.had : bottle.prepared;
		const data = {
			device_id: deviceId,
			amount: Math.round( amount * 100 ) / 100,
			units: units === 'ml' ? 'ml' : 'oz',
			bottle_type: TYPES.some( ( t ) => t.id === bottle.type ) ? bottle.type : 'other',
			start_time: isoWithOffset( bottle.started ),
		};
		const text = String( bottle.note || '' ).trim();
		if ( text ) {
			data.notes = text;
		}
		return { domain: 'huckleberry', service: 'log_bottle', data };
	}

	/** The helper writes that open a bottle: [ { domain, service, data } ] (started, prepared, had, type, note). */
	function openWrites( ids, bottle ) {
		return [
			{ domain: 'input_datetime', service: 'set_datetime', data: { entity_id: ids.started, timestamp: Math.floor( bottle.started / 1000 ) } },
			{ domain: 'input_number', service: 'set_value', data: { entity_id: ids.prepared, value: bottle.prepared } },
			{ domain: 'input_number', service: 'set_value', data: { entity_id: ids.had, value: bottle.prepared } },
			{ domain: 'input_select', service: 'select_option', data: { entity_id: ids.type, option: bottle.type } },
			{ domain: 'input_text', service: 'set_value', data: { entity_id: ids.note, value: String( bottle.note || '' ).slice( 0, 255 ) } },
		];
	}

	/** The helper writes that close the bottle (prepared 0 = none open). */
	function closeWrites( ids ) {
		return [
			{ domain: 'input_number', service: 'set_value', data: { entity_id: ids.prepared, value: 0 } },
			{ domain: 'input_number', service: 'set_value', data: { entity_id: ids.had, value: 0 } },
			{ domain: 'input_text', service: 'set_value', data: { entity_id: ids.note, value: '' } },
		];
	}

	/** An amount rounded to the step and kept within 0..max. */
	function clampAmount( value, unit ) {
		const n = Number( value );
		if ( ! Number.isFinite( n ) ) {
			return 0;
		}
		const step = unit.step || 0.5;
		const rounded = Math.round( n / step ) * step;
		const fixed = Number( rounded.toFixed( 3 ) );
		return Math.min( unit.max || 2000, Math.max( 0, fixed ) );
	}

	/** "4", "4.5", "120" — an amount without trailing zeros. */
	function amountText( value ) {
		const n = Number( value );
		if ( ! Number.isFinite( n ) ) {
			return '';
		}
		return String( Math.round( n * 100 ) / 100 );
	}

	function typeLabel( id ) {
		const t = TYPES.find( ( x ) => x.id === id );
		return t ? t.label : String( id || '' ).replace( /_/g, ' ' );
	}

	/** The last bottle from sensor.<child>_bottle: { time, amount, units, type } or null. */
	function lastBottleFrom( state ) {
		if ( ! state || ! state.state || state.state === 'unknown' || state.state === 'unavailable' ) {
			return null;
		}
		const a = state.attributes || {};
		const time = Date.parse( a.time || state.state );
		if ( Number.isNaN( time ) ) {
			return null;
		}
		return {
			time,
			amount: a.amount == null || a.amount === '' ? NaN : Number( a.amount ),
			units: a.units ? String( a.units ) : '',
			type: a.type ? String( a.type ) : '',
		};
	}

	/** The types offered, from config (unknown ones dropped), else formula and breast milk. */
	function typesOffered( config ) {
		const wanted = Array.isArray( config && config.bottle_types ) ? config.bottle_types : DEFAULT_TYPES;
		const ids = wanted.map( ( t ) => String( t ).trim().toLowerCase().replace( /\s+/g, '_' ) ).filter( ( id ) => TYPES.some( ( t ) => t.id === id ) );
		return ( ids.length ? ids : DEFAULT_TYPES ).map( ( id ) => TYPES.find( ( t ) => t.id === id ) );
	}

	/** Words for an error from hass.callService / callWS. */
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

	/** "2 h ago" style. */
	function relative( ms, now ) {
		const then = Number( ms );
		if ( ! Number.isFinite( then ) ) {
			return '';
		}
		const s = Math.round( ( ( now || Date.now() ) - then ) / 1000 );
		if ( s < 60 ) {
			return 'just now';
		}
		const m = Math.round( s / 60 );
		if ( m < 60 ) {
			return m + ' min ago';
		}
		const h = Math.floor( m / 60 );
		const rem = m % 60;
		if ( h < 24 ) {
			return rem ? h + ' h ' + rem + ' min ago' : h + ' h ago';
		}
		const d = Math.floor( h / 24 );
		return d === 1 ? 'yesterday' : d + ' days ago';
	}

	function clock( ms, locale ) {
		if ( ! Number.isFinite( Number( ms ) ) ) {
			return '';
		}
		try {
			return new Date( Number( ms ) ).toLocaleTimeString( locale || undefined, { hour: 'numeric', minute: '2-digit' } );
		} catch {
			return new Date( Number( ms ) ).toTimeString().slice( 0, 5 );
		}
	}

	/* ---- The card ------------------------------------------------------------------------- */

	const STYLE = `
		:host { display: block; }
		ha-card { padding: 16px; box-sizing: border-box; }
		.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
		.title { font-size: 1.25rem; font-weight: 500; color: var(--primary-text-color); line-height: 1.3; }
		.last { font-size: 0.875rem; color: var(--secondary-text-color); text-align: right; line-height: 1.3; }
		.last b { color: var(--primary-text-color); font-weight: 500; }
		.label { font-size: 0.8125rem; font-weight: 500; color: var(--secondary-text-color); margin: 14px 0 6px; letter-spacing: 0.02em; }
		.label:first-child { margin-top: 0; }
		.row { display: grid; gap: 8px; }
		.row.types { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
		.choice {
			appearance: none; -webkit-appearance: none; font: inherit; cursor: pointer; margin: 0;
			min-height: 48px; padding: 6px 4px; border-radius: 12px;
			border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
			background: var(--card-background-color, #fff);
			color: var(--primary-text-color);
			display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
			transition: background 120ms, border-color 120ms, color 120ms;
			-webkit-tap-highlight-color: transparent;
		}
		.choice ha-icon { --mdc-icon-size: 22px; }
		.choice span { font-size: 0.8125rem; line-height: 1.2; }
		.choice:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
		.choice[aria-pressed="true"] { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
		.choice:disabled { opacity: 0.5; cursor: default; }
		.stepper { display: grid; grid-template-columns: 56px minmax(0, 1fr) 56px; gap: 8px; align-items: stretch; }
		.stepper button {
			appearance: none; -webkit-appearance: none; font: inherit; cursor: pointer; margin: 0;
			min-height: 48px; border-radius: 12px; font-size: 1.5rem; line-height: 1;
			border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
			background: var(--card-background-color, #fff); color: var(--primary-text-color);
			-webkit-tap-highlight-color: transparent;
		}
		.stepper button:disabled { opacity: 0.5; cursor: default; }
		.stepper button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
		.stepper .box { position: relative; }
		.stepper input {
			font: inherit; width: 100%; height: 100%; box-sizing: border-box; margin: 0; min-height: 48px;
			padding: 10px 44px 10px 12px; border-radius: 12px; text-align: center; font-size: 1.25rem; font-weight: 500;
			border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
			background: var(--card-background-color, #fff); color: var(--primary-text-color);
			-moz-appearance: textfield;
		}
		.stepper input::-webkit-outer-spin-button, .stepper input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
		.stepper input:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; border-color: var(--primary-color); }
		.stepper .unit { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); color: var(--secondary-text-color); font-size: 0.875rem; pointer-events: none; }
		textarea {
			font: inherit; width: 100%; box-sizing: border-box; margin: 0;
			padding: 10px 12px; border-radius: 10px; min-height: 56px; resize: vertical;
			border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
			background: var(--card-background-color, #fff); color: var(--primary-text-color);
		}
		textarea::placeholder { color: var(--secondary-text-color); opacity: 0.8; }
		textarea:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; border-color: var(--primary-color); }
		.open {
			margin-top: 2px; padding: 12px 14px; border-radius: 12px;
			border: 1px solid var(--primary-color); color: var(--primary-text-color); line-height: 1.4;
		}
		.open .since { font-size: 1rem; font-weight: 500; }
		.open .what { font-size: 0.875rem; color: var(--secondary-text-color); }
		.open .note { font-size: 0.875rem; color: var(--secondary-text-color); font-style: italic; white-space: pre-wrap; }
		.primary, .secondary {
			appearance: none; -webkit-appearance: none; font: inherit; cursor: pointer; margin: 16px 0 0;
			width: 100%; min-height: 48px; border-radius: 12px; border: 0;
			font-size: 1rem; font-weight: 500; letter-spacing: 0.02em;
			display: flex; align-items: center; justify-content: center; gap: 8px;
		}
		.primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
		.primary.done { background: var(--success-color, #43a047); }
		.secondary { margin-top: 8px; background: transparent; color: var(--primary-color); border: 1px solid var(--primary-color); }
		.primary:disabled, .secondary:disabled { opacity: 0.45; cursor: default; }
		.primary:focus-visible, .secondary:focus-visible { outline: 2px solid var(--primary-text-color); outline-offset: 2px; }
		.hint { font-size: 0.8125rem; color: var(--secondary-text-color); margin-top: 6px; }
		.error {
			margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 0.875rem; line-height: 1.4;
			background: var(--error-color, #db4437); color: var(--text-primary-color, #fff);
		}
		.warn {
			margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 0.875rem; line-height: 1.4;
			border: 1px solid var(--warning-color, #ffa600); color: var(--primary-text-color);
		}
		.warn code { font-size: 0.8125rem; }
		[hidden] { display: none !important; }
	`;

	class HuckleberryFeedingCard extends HTMLElement {
		static getConfigElement() {
			return document.createElement( EDITOR );
		}

		static getStubConfig( hass ) {
			const entity = hass && hass.states
				? Object.keys( hass.states ).find( ( id ) => /^sensor\..*_bottle$/.test( id ) )
				: undefined;
			return { bottle_entity: entity || 'sensor.child_bottle' };
		}

		constructor() {
			super();
			this.attachShadow( { mode: 'open' } );
			this._config = null;
			this._hass = null;
			this._amount = NaN; // the new bottle's prepared amount (NaN = the default)
			this._type = '';
			this._note = '';
			this._had = NaN; // what the open bottle's "had" box shows while being edited
			this._hadTimer = null;
			this._another = false; // the new-bottle form shown under an open bottle
			this._busy = false;
			this._error = '';
			this._logged = false;
			this._deviceId = undefined;
			this._lookupFor = '';
			this._built = false;
			this._tick = null;
		}

		setConfig( config ) {
			if ( ! config || ! config.bottle_entity ) {
				throw new Error( 'bottle_entity is required: the child\'s "last bottle" sensor, such as sensor.<child>_bottle.' );
			}
			if ( config.units && config.units !== 'oz' && config.units !== 'ml' ) {
				throw new Error( 'units must be oz or ml.' );
			}
			this._config = { ...config };
			this._unit = unitSettings( this._config );
			this._ids = helperIds( this._config.helper_prefix );
			this._types = typesOffered( this._config );
			const wanted = String( this._config.default_type || '' ).toLowerCase();
			this._type = this._types.some( ( t ) => t.id === wanted ) ? wanted : this._types[ 0 ].id;
			this._amount = NaN;
			this._lookupFor = '';
			this._render();
			if ( this._hass ) {
				this._lookup();
			}
		}

		set hass( hass ) {
			const first = ! this._hass;
			this._hass = hass;
			if ( ! this._config ) {
				return;
			}
			if ( first || this._lookupFor !== this._lookupKey() ) {
				this._lookup();
			}
			this._render();
		}

		get hass() {
			return this._hass;
		}

		connectedCallback() {
			if ( ! this._tick ) {
				this._tick = setInterval( () => this._renderOpen(), TICK_MS );
			}
		}

		disconnectedCallback() {
			clearInterval( this._tick );
			this._tick = null;
		}

		getCardSize() {
			return 6;
		}

		getGridOptions() {
			return { columns: 12, min_columns: 6, rows: 'auto' };
		}

		/* ---- lookups --------------------------------------------------------------------- */

		_lookupKey() {
			return [ this._config.bottle_entity, this._config.huckleberry_device_id ].join( '|' );
		}

		async _lookup() {
			const key = this._lookupKey();
			this._lookupFor = key;
			this._deviceId = this._config.huckleberry_device_id || undefined;
			if ( this._deviceId || ! this._hass.callWS ) {
				return;
			}
			try {
				const reg = await this._hass.callWS( { type: 'config/entity_registry/get', entity_id: this._config.bottle_entity } );
				if ( this._lookupFor === key && reg && reg.device_id ) {
					this._deviceId = reg.device_id;
				}
			} catch {
				// No registry record: the error shows when a bottle is finished.
			}
		}

		_states() {
			return this._hass && this._hass.states ? this._hass.states : {};
		}

		_open() {
			return openBottleFrom( this._states(), this._ids );
		}

		/* ---- actions --------------------------------------------------------------------- */

		async _calls( list ) {
			for ( const c of list ) {
				await this._hass.callService( c.domain, c.service, c.data );
			}
		}

		async _finish( open ) {
			if ( ! this._deviceId ) {
				throw new Error( 'No Huckleberry device for ' + this._config.bottle_entity + ': set huckleberry_device_id.' );
			}
			const bottle = { ...open };
			if ( Number.isFinite( this._had ) && this._had > 0 ) {
				bottle.had = this._had;
			}
			const call = logBottleCall( bottle, this._deviceId, this._unit.id );
			try {
				await this._hass.callService( call.domain, call.service, call.data );
			} catch ( err ) {
				throw new Error( 'Huckleberry did not log the bottle: ' + errorText( err, 'unknown error' ) );
			}
			await this._calls( closeWrites( this._ids ) );
		}

		/** Finish: log the open bottle with what was had, then clear the helpers. */
		async _onFinish() {
			const open = this._open();
			if ( this._busy || ! open ) {
				return;
			}
			this._begin();
			try {
				await this._finish( open );
				this._had = NaN;
				this._done();
			} catch ( err ) {
				this._fail( err );
			}
		}

		/** Start: finish an open bottle first (with its had amount), then write the new one. */
		async _onStart() {
			if ( this._busy ) {
				return;
			}
			const prepared = clampAmount( Number.isFinite( this._amount ) ? this._amount : this._unit.amount, this._unit );
			if ( ! ( prepared > 0 ) ) {
				this._error = 'Enter how much was prepared.';
				this._renderForm();
				return;
			}
			if ( missingHelpers( this._states(), this._ids ).length ) {
				this._error = 'The bottle helpers are missing (see the note above).';
				this._renderForm();
				return;
			}
			this._begin();
			try {
				const open = this._open();
				if ( open ) {
					await this._finish( open );
				}
				await this._calls( openWrites( this._ids, { started: Date.now(), prepared, type: this._type, note: this._note } ) );
				this._note = '';
				this._amount = NaN;
				this._had = NaN;
				this._another = false;
				this._done();
			} catch ( err ) {
				this._fail( err );
			}
		}

		/** The had box: written to the helper so other phones see it, a moment after the last change. */
		_setHad( value ) {
			this._had = clampAmount( value, this._unit );
			this._renderOpen();
			clearTimeout( this._hadTimer );
			this._hadTimer = setTimeout( () => {
				const open = this._open();
				if ( open && this._hass && Number.isFinite( this._had ) && this._had !== open.had ) {
					this._hass.callService( 'input_number', 'set_value', { entity_id: this._ids.had, value: this._had } ).catch( () => undefined );
				}
			}, 500 );
		}

		_begin() {
			this._error = '';
			this._logged = false;
			this._busy = true;
			this._render();
		}

		_done() {
			this._busy = false;
			this._logged = true;
			this._render();
			clearTimeout( this._loggedTimer );
			this._loggedTimer = setTimeout( () => {
				this._logged = false;
				this._render();
			}, LOGGED_FOR );
		}

		_fail( err ) {
			this._busy = false;
			this._error = errorText( err, 'Could not do that.' );
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
							<div class="last"></div>
						</div>
						<div class="helpers"></div>
						<div class="open-wrap">
							<div class="label">Bottle in progress</div>
							<div class="open">
								<div class="since"></div>
								<div class="what"></div>
								<div class="note"></div>
							</div>
							<div class="label">Had</div>
							<div class="stepper had">
								<button type="button" class="minus" aria-label="Less">−</button>
								<div class="box"><input type="number" inputmode="decimal" aria-label="Amount had"><span class="unit"></span></div>
								<button type="button" class="plus" aria-label="More">+</button>
							</div>
							<button type="button" class="primary finish"></button>
							<button type="button" class="secondary another">Start another bottle…</button>
						</div>
						<div class="form">
							<div class="label prepared-label">Prepared</div>
							<div class="stepper prepared">
								<button type="button" class="minus" aria-label="Less">−</button>
								<div class="box"><input type="number" inputmode="decimal" aria-label="Amount prepared"><span class="unit"></span></div>
								<button type="button" class="plus" aria-label="More">+</button>
							</div>
							<div class="label">Contents</div>
							<div class="row types" role="group" aria-label="Contents"></div>
							<div class="label">Note</div>
							<textarea rows="2" placeholder="Anything to remember (optional)"></textarea>
							<button type="button" class="primary start"></button>
						</div>
						<div class="message"></div>
					</ha-card>
				`;
				const q = ( s ) => root.querySelector( s );
				this._el = {
					title: q( '.title' ), last: q( '.last' ), helpers: q( '.helpers' ),
					openWrap: q( '.open-wrap' ), since: q( '.since' ), what: q( '.what' ), openNote: q( '.open .note' ),
					hadMinus: q( '.had .minus' ), hadPlus: q( '.had .plus' ), hadInput: q( '.had input' ), hadUnit: q( '.had .unit' ),
					finish: q( '.finish' ), another: q( '.another' ),
					form: q( '.form' ), preparedLabel: q( '.prepared-label' ),
					prepMinus: q( '.prepared .minus' ), prepPlus: q( '.prepared .plus' ), prepInput: q( '.prepared input' ), prepUnit: q( '.prepared .unit' ),
					types: q( '.types' ), note: q( 'textarea' ), start: q( '.start' ), message: q( '.message' ),
				};
				this._el.hadMinus.addEventListener( 'click', () => this._setHad( this._hadShown() - this._unit.step ) );
				this._el.hadPlus.addEventListener( 'click', () => this._setHad( this._hadShown() + this._unit.step ) );
				this._el.hadInput.addEventListener( 'change', () => this._setHad( this._el.hadInput.value ) );
				this._el.finish.addEventListener( 'click', () => this._onFinish() );
				this._el.another.addEventListener( 'click', () => {
					this._another = ! this._another;
					this._render();
				} );
				this._el.prepMinus.addEventListener( 'click', () => this._setAmount( this._amountShown() - this._unit.step ) );
				this._el.prepPlus.addEventListener( 'click', () => this._setAmount( this._amountShown() + this._unit.step ) );
				this._el.prepInput.addEventListener( 'change', () => this._setAmount( this._el.prepInput.value ) );
				this._el.note.addEventListener( 'input', () => {
					this._note = this._el.note.value;
				} );
				this._el.start.addEventListener( 'click', () => this._onStart() );
				this._built = true;
			}
			this._el.title.textContent = this._config.child_name || this._childName();
			this._renderLast();
			this._renderHelpers();
			this._renderOpen();
			this._renderForm();
		}

		_childName() {
			const st = this._states()[ this._config.bottle_entity ];
			const friendly = st && st.attributes && st.attributes.friendly_name;
			if ( friendly ) {
				return String( friendly ).replace( /\s+bottle$/i, '' ).trim() || friendly;
			}
			const id = String( this._config.bottle_entity ).split( '.' )[ 1 ] || '';
			return id.replace( /_bottle$/, '' ).replace( /_/g, ' ' ).replace( /\b\w/g, ( c ) => c.toUpperCase() );
		}

		_renderLast() {
			const st = this._states()[ this._config.bottle_entity ];
			if ( ! st ) {
				this._el.last.innerHTML = '<b>' + escapeHtml( this._config.bottle_entity ) + '</b><br>not found';
				return;
			}
			const last = lastBottleFrom( st );
			if ( ! last ) {
				this._el.last.innerHTML = 'Last bottle<br><b>none yet</b>';
				return;
			}
			const locale = this._hass.locale && this._hass.locale.language;
			const what = [ Number.isFinite( last.amount ) ? amountText( last.amount ) + ' ' + ( last.units || this._unit.label ) : '', last.type ].filter( Boolean ).join( ' · ' );
			this._el.last.innerHTML = 'Last bottle' + ( what ? ' · ' + escapeHtml( what ) : '' ) + '<br><b>' + escapeHtml( relative( last.time ) ) + '</b> · ' + escapeHtml( clock( last.time, locale ) );
		}

		_renderHelpers() {
			const missing = missingHelpers( this._states(), this._ids );
			if ( ! missing.length ) {
				this._el.helpers.innerHTML = '';
				return;
			}
			this._el.helpers.innerHTML = '<div class="warn">The bottle helpers are missing: ' + missing.map( ( id ) => '<code>' + escapeHtml( id ) + '</code>' ).join( ', ' )
				+ '. Copy <code>packages/huckleberry_feeding.yaml</code> from the card\'s repository into your config\'s <code>packages/</code> folder (with <code>homeassistant: packages: !include_dir_named packages</code> in configuration.yaml), restart, and set <code>helper_prefix</code> if you changed the names.</div>';
		}

		_hadShown() {
			const open = this._open();
			return Number.isFinite( this._had ) ? this._had : ( open ? open.had : 0 );
		}

		_amountShown() {
			return Number.isFinite( this._amount ) ? this._amount : this._unit.amount;
		}

		_setAmount( value ) {
			this._amount = clampAmount( value, this._unit );
			this._error = '';
			this._renderForm();
		}

		_renderOpen() {
			if ( ! this._el ) {
				return;
			}
			const open = this._open();
			this._el.openWrap.hidden = ! open;
			if ( ! open ) {
				this._had = NaN;
				return;
			}
			const locale = this._hass.locale && this._hass.locale.language;
			this._el.since.textContent = 'Started ' + clock( open.started, locale ) + ' · ' + relative( open.started );
			this._el.what.textContent = amountText( open.prepared ) + ' ' + this._unit.label + ' prepared · ' + typeLabel( open.type );
			this._el.openNote.textContent = open.note;
			this._el.openNote.hidden = ! open.note;
			const had = this._hadShown();
			if ( document.activeElement !== this._el.hadInput && this._el.hadInput.value !== amountText( had ) ) {
				this._el.hadInput.value = amountText( had );
			}
			this._el.hadInput.step = String( this._unit.step );
			this._el.hadInput.min = '0';
			this._el.hadUnit.textContent = this._unit.label;
			for ( const b of [ this._el.hadMinus, this._el.hadPlus, this._el.hadInput ] ) {
				b.disabled = this._busy;
			}
			this._el.hadMinus.disabled = this._busy || had <= 0;
			const f = this._el.finish;
			f.disabled = this._busy;
			f.classList.toggle( 'done', this._logged );
			if ( this._busy ) {
				f.innerHTML = '<ha-icon icon="mdi:timer-sand"></ha-icon><span>Logging…</span>';
			} else if ( this._logged ) {
				f.innerHTML = '<ha-icon icon="mdi:check"></ha-icon><span>Logged</span>';
			} else {
				f.innerHTML = '<ha-icon icon="mdi:check"></ha-icon><span>Finish · log ' + escapeHtml( amountText( had ) + ' ' + this._unit.label ) + '</span>';
			}
			this._el.another.disabled = this._busy;
			this._el.another.textContent = this._another ? 'Keep this bottle' : 'Start another bottle…';
		}

		_renderForm() {
			if ( ! this._el ) {
				return;
			}
			const open = this._open();
			const show = ! open || this._another;
			this._el.form.hidden = ! show;
			this._el.message.innerHTML = this._error ? '<div class="error" role="alert">' + escapeHtml( this._error ) + '</div>' : '';
			if ( ! show ) {
				return;
			}
			this._el.preparedLabel.textContent = open ? 'Next bottle · prepared' : 'Prepared';
			const amount = this._amountShown();
			if ( document.activeElement !== this._el.prepInput && this._el.prepInput.value !== amountText( amount ) ) {
				this._el.prepInput.value = amountText( amount );
			}
			this._el.prepInput.step = String( this._unit.step );
			this._el.prepInput.min = '0';
			this._el.prepUnit.textContent = this._unit.label;
			this._el.prepMinus.disabled = this._busy || amount <= 0;
			this._el.prepPlus.disabled = this._busy;
			this._el.prepInput.disabled = this._busy;
			const types = this._el.types;
			if ( types.childElementCount !== this._types.length || [ ...types.children ].some( ( b, i ) => b.dataset.type !== this._types[ i ].id ) ) {
				types.innerHTML = '';
				for ( const t of this._types ) {
					const b = document.createElement( 'button' );
					b.type = 'button';
					b.className = 'choice';
					b.dataset.type = t.id;
					b.innerHTML = '<ha-icon icon="' + t.icon + '"></ha-icon><span>' + escapeHtml( t.label ) + '</span>';
					b.addEventListener( 'click', () => {
						this._type = t.id;
						this._error = '';
						this._renderForm();
					} );
					types.appendChild( b );
				}
			}
			for ( const b of types.children ) {
				b.setAttribute( 'aria-pressed', String( b.dataset.type === this._type ) );
				b.disabled = this._busy;
			}
			if ( this._el.note.value !== this._note ) {
				this._el.note.value = this._note;
			}
			this._el.note.disabled = this._busy;
			const s = this._el.start;
			const missing = missingHelpers( this._states(), this._ids ).length > 0;
			s.disabled = this._busy || missing || ! ( amount > 0 );
			s.classList.toggle( 'done', this._logged && ! open );
			if ( this._busy ) {
				s.innerHTML = '<ha-icon icon="mdi:timer-sand"></ha-icon><span>Saving…</span>';
			} else if ( open ) {
				s.innerHTML = '<ha-icon icon="mdi:baby-bottle"></ha-icon><span>Finish that one and start this</span>';
			} else {
				s.innerHTML = '<ha-icon icon="mdi:baby-bottle"></ha-icon><span>Start bottle</span>';
			}
		}
	}

	function escapeHtml( s ) {
		return String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );
	}

	/* ---- A small config editor for the card picker -------------------------------------- */

	class HuckleberryFeedingCardEditor extends HTMLElement {
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
						if ( value[ k ] === '' || value[ k ] === null || value[ k ] === undefined || ( Array.isArray( value[ k ] ) && ! value[ k ].length ) ) {
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
		{ name: 'bottle_entity', required: true, selector: { entity: { domain: 'sensor' } } },
		{ name: 'child_name', selector: { text: {} } },
		{ name: 'units', selector: { select: { mode: 'dropdown', options: [ { value: 'oz', label: 'Ounces (oz)' }, { value: 'ml', label: 'Millilitres (ml)' } ] } } },
		{ name: 'default_amount', selector: { number: { min: 0, max: 2000, step: 0.5, mode: 'box' } } },
		{ name: 'step', selector: { number: { min: 0.1, max: 100, step: 0.1, mode: 'box' } } },
		{ name: 'bottle_types', selector: { select: { multiple: true, mode: 'list', options: TYPES.map( ( t ) => ( { value: t.id, label: t.label } ) ) } } },
		{ name: 'default_type', selector: { select: { mode: 'dropdown', options: TYPES.map( ( t ) => ( { value: t.id, label: t.label } ) ) } } },
		{ name: 'helper_prefix', selector: { text: {} } },
		{ name: 'huckleberry_device_id', selector: { device: { integration: 'huckleberry' } } },
	];
	const LABELS = {
		bottle_entity: 'Bottle sensor',
		child_name: 'Child\'s name',
		units: 'Units',
		default_amount: 'Prepared amount preselected',
		step: 'Step of − / +',
		bottle_types: 'Contents offered',
		default_type: 'Contents preselected',
		helper_prefix: 'Helpers\' prefix',
		huckleberry_device_id: 'Huckleberry child device',
	};
	const HELPERS = {
		bottle_entity: 'The child\'s "last bottle" sensor from the Huckleberry integration.',
		child_name: 'Shown as the title. Default: from the sensor\'s name.',
		units: 'Default: oz. The helpers hold amounts in this unit, so give every feeding card the same.',
		default_amount: 'Default: 4 oz or 120 ml.',
		step: 'Default: 0.5 oz or 10 ml.',
		bottle_types: 'Default: Formula and Breast milk.',
		helper_prefix: 'Default: huckleberry, as in input_number.huckleberry_bottle_prepared (packages/huckleberry_feeding.yaml).',
		huckleberry_device_id: 'Default: the device that owns the bottle sensor.',
	};

	if ( ! customElements.get( CARD ) ) {
		customElements.define( CARD, HuckleberryFeedingCard );
	}
	if ( ! customElements.get( EDITOR ) ) {
		customElements.define( EDITOR, HuckleberryFeedingCardEditor );
	}
	window.customCards = window.customCards || [];
	if ( ! window.customCards.some( ( c ) => c.type === CARD ) ) {
		window.customCards.push( {
			type: CARD,
			name: 'Huckleberry feeding card',
			description: 'Start a bottle, then log in Huckleberry what the child had.',
			preview: false,
			documentationURL: 'https://github.com/trevorbicewebdesign/huckleberry-dashboard',
		} );
	}

	// For tests (Node/jsdom): the pure logic, without touching the page.
	const logic = {
		TYPES, UNITS, unitSettings, helperIds, missingHelpers, helperTime, openBottleFrom, isoWithOffset, logBottleCall,
		openWrites, closeWrites, clampAmount, amountText, typeLabel, lastBottleFrom, typesOffered, errorText, relative,
	};
	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = logic;
	}
	window.__huckleberryFeedingCardLogic = logic;
} )();
