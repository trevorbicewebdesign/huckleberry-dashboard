/**
 * Huckleberry sleep card — a Home Assistant custom card.
 *
 * The child's sleep timer from Huckleberry (Woyken's integration): start, pause, resume and
 * complete it, see how long the child has been asleep, correct the start time of a running
 * timer, and log a past sleep by its start and end. One file, no build step.
 *
 * Config (YAML):
 *   type: custom:huckleberry-sleep-card
 *   sleep_entity: sensor.<child>_sleep         # required: the child's sleep status sensor
 *   child_name: <name>                         # default: from the entity's friendly name
 *   huckleberry_device_id: <device id>         # default: the device that owns sleep_entity
 *   integration_version: 0.5.6                 # default: read from the actions Home Assistant lists;
 *                                              # the start-time and past-sleep controls need 0.5.6
 *   log_form: true                             # show "Log a past sleep" (default true)
 *
 * The card keeps a global here only to register with the card picker.
 */
( () => {
	'use strict';

	const CARD = 'huckleberry-sleep-card';
	const EDITOR = 'huckleberry-sleep-card-editor';

	const NEEDS_VERSION = '0.5.6';
	const TICK_MS = 1000;
	const DONE_FOR = 2500;

	/* ---- Pure logic (also what tests/check-sleep.js exercises) --------------------------- */

	/** A time (ms) from an ISO string or epoch number, else NaN. */
	function parseWhen( value ) {
		if ( value == null || value === '' ) {
			return NaN;
		}
		if ( typeof value === 'number' ) {
			return value > 1e11 ? value : value * 1000;
		}
		const s = String( value ).trim();
		if ( /^\d+(\.\d+)?$/.test( s ) ) {
			return parseWhen( Number( s ) );
		}
		return Date.parse( s );
	}

	/** Milliseconds from an ISO 8601 duration ("PT1H23M5S", "P1DT2H"), "1:23:05", or seconds; NaN otherwise. */
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
			const [ , d, h, m, sec ] = iso;
			return ( ( Number( d || 0 ) * 24 + Number( h || 0 ) ) * 3600 + Number( m || 0 ) * 60 + Number( sec || 0 ) ) * 1000;
		}
		const clock = /^(\d+):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec( s );
		if ( clock ) {
			return ( Number( clock[ 1 ] ) * 3600 + Number( clock[ 2 ] ) * 60 + Number( clock[ 3 ] || 0 ) ) * 1000;
		}
		if ( /^\d+(\.\d+)?$/.test( s ) ) {
			return Number( s ) * 1000;
		}
		return NaN;
	}

	/**
	 * The timer from sensor.<child>_sleep: { status: active | paused | none | unknown, start, end,
	 * previousStart, previousDuration (ms) }. The integration's states are active / paused / none,
	 * with attributes current_start, current_end (only while paused), previous_start and
	 * previous_duration (an ISO 8601 duration).
	 */
	function sleepFrom( state ) {
		const a = ( state && state.attributes ) || {};
		const raw = state ? String( state.state || '' ).toLowerCase() : '';
		let status = 'unknown';
		if ( raw === 'active' || raw === 'sleeping' || raw === 'on' ) {
			status = 'active';
		} else if ( raw === 'paused' ) {
			status = 'paused';
		} else if ( raw === 'none' || raw === 'awake' || raw === 'off' ) {
			status = 'none';
		}
		return {
			status,
			start: parseWhen( a.current_start ),
			end: status === 'paused' ? parseWhen( a.current_end ) : NaN,
			previousStart: parseWhen( a.previous_start ),
			previousDuration: parseDuration( a.previous_duration ),
		};
	}

	/** How long the timer has run (ms): to now while active, to the pause while paused. */
	function elapsed( sleep, now ) {
		if ( ! sleep || ! Number.isFinite( sleep.start ) ) {
			return NaN;
		}
		if ( sleep.status === 'active' ) {
			return Math.max( 0, ( now || Date.now() ) - sleep.start );
		}
		if ( sleep.status === 'paused' ) {
			return Math.max( 0, ( Number.isFinite( sleep.end ) ? sleep.end : ( now || Date.now() ) ) - sleep.start );
		}
		return NaN;
	}

	/** "1 h 23 min", "45 min", "40 s". */
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

	/** -1, 0 or 1 comparing "0.5.6"-style versions (beta suffixes ignored). */
	function compareVersions( a, b ) {
		const parse = ( v ) => String( v || '' ).replace( /^v/i, '' ).split( /[-+]/ )[ 0 ].split( '.' ).map( ( x ) => parseInt( x, 10 ) || 0 );
		const x = parse( a );
		const y = parse( b );
		for ( let i = 0; i < Math.max( x.length, y.length ); i++ ) {
			const d = ( x[ i ] || 0 ) - ( y[ i ] || 0 );
			if ( d ) {
				return d < 0 ? -1 : 1;
			}
		}
		return 0;
	}

	/**
	 * Whether the installed integration takes the time overrides (start_sleep's start_time,
	 * log_sleep), added in 0.5.6: by integration_version when configured, else from the action
	 * descriptions Home Assistant gives the browser (hass.services). Unknown → false.
	 */
	function supportsTimes( services, configVersion ) {
		if ( configVersion ) {
			return compareVersions( configVersion, NEEDS_VERSION ) >= 0;
		}
		const h = services && services.huckleberry;
		if ( ! h ) {
			return false;
		}
		const start = h.start_sleep;
		return !! ( start && start.fields && start.fields.start_time && h.log_sleep );
	}

	/** Whether the integration's sleep actions are there at all. */
	function hasSleepActions( services ) {
		const h = services && services.huckleberry;
		return !! ( h && h.start_sleep && h.complete_sleep );
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

	function sleepCall( service, deviceId, extra ) {
		if ( ! deviceId ) {
			throw new Error( 'No Huckleberry device: set huckleberry_device_id.' );
		}
		return { domain: 'huckleberry', service, data: { device_id: deviceId, ...( extra || {} ) } };
	}

	/** start_sleep, with start_time when given (on a running timer the integration moves its start). */
	function startCall( deviceId, startMs, now ) {
		if ( startMs !== undefined && startMs !== null ) {
			if ( ! Number.isFinite( startMs ) ) {
				throw new Error( 'Pick a start time.' );
			}
			if ( startMs > ( now || Date.now() ) + 60000 ) {
				throw new Error( 'The start time is in the future.' );
			}
			return sleepCall( 'start_sleep', deviceId, { start_time: isoWithOffset( startMs ) } );
		}
		return sleepCall( 'start_sleep', deviceId );
	}

	/** log_sleep for a finished sleep: start before end, neither in the future, notes only when typed. */
	function logSleepCall( deviceId, startMs, endMs, note, now ) {
		if ( ! Number.isFinite( startMs ) || ! Number.isFinite( endMs ) ) {
			throw new Error( 'Pick when the sleep started and ended.' );
		}
		if ( endMs <= startMs ) {
			throw new Error( 'The end must come after the start.' );
		}
		if ( endMs > ( now || Date.now() ) + 60000 ) {
			throw new Error( 'The end time is in the future.' );
		}
		const extra = { start_time: isoWithOffset( startMs ), end_time: isoWithOffset( endMs ) };
		const text = String( note || '' ).trim();
		if ( text ) {
			extra.notes = text;
		}
		return sleepCall( 'log_sleep', deviceId, extra );
	}

	/** "HH:MM" (local) for a time input. */
	function timeValue( ms ) {
		if ( ! Number.isFinite( ms ) ) {
			return '';
		}
		const d = new Date( ms );
		return String( d.getHours() ).padStart( 2, '0' ) + ':' + String( d.getMinutes() ).padStart( 2, '0' );
	}

	/** "YYYY-MM-DDTHH:MM" (local) for a datetime-local input. */
	function datetimeValue( ms ) {
		if ( ! Number.isFinite( ms ) ) {
			return '';
		}
		const d = new Date( ms );
		const pad = ( n ) => String( n ).padStart( 2, '0' );
		return d.getFullYear() + '-' + pad( d.getMonth() + 1 ) + '-' + pad( d.getDate() ) + 'T' + timeValue( ms );
	}

	/** ms from a datetime-local value ("YYYY-MM-DDTHH:MM"), read as local time. */
	function parseDatetimeValue( value ) {
		const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec( String( value || '' ).trim() );
		if ( ! m ) {
			return NaN;
		}
		return new Date( Number( m[ 1 ] ), Number( m[ 2 ] ) - 1, Number( m[ 3 ] ), Number( m[ 4 ] ), Number( m[ 5 ] ), Number( m[ 6 ] || 0 ) ).getTime();
	}

	/**
	 * ms for "HH:MM" on the same day as a reference time (the current start); a result after now
	 * is taken as yesterday (a nap that started before midnight).
	 */
	function timeOnDay( value, referenceMs, now ) {
		const m = /^(\d{1,2}):(\d{2})$/.exec( String( value || '' ).trim() );
		if ( ! m ) {
			return NaN;
		}
		const ref = new Date( Number.isFinite( referenceMs ) ? referenceMs : ( now || Date.now() ) );
		let t = new Date( ref.getFullYear(), ref.getMonth(), ref.getDate(), Number( m[ 1 ] ), Number( m[ 2 ] ), 0 ).getTime();
		if ( t > ( now || Date.now() ) + 60000 ) {
			t -= 86400000;
		}
		return t;
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
		if ( ! Number.isFinite( ms ) ) {
			return '';
		}
		const s = Math.round( ( ( now || Date.now() ) - ms ) / 1000 );
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
		if ( ! Number.isFinite( ms ) ) {
			return '';
		}
		try {
			return new Date( ms ).toLocaleTimeString( locale || undefined, { hour: 'numeric', minute: '2-digit' } );
		} catch {
			return new Date( ms ).toTimeString().slice( 0, 5 );
		}
	}

	/* ---- The card ------------------------------------------------------------------------- */

	const STYLE = `
		:host { display: block; }
		ha-card { padding: 16px; box-sizing: border-box; }
		.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
		.title { font-size: 1.25rem; font-weight: 500; color: var(--primary-text-color); line-height: 1.3; }
		.prev { font-size: 0.875rem; color: var(--secondary-text-color); text-align: right; line-height: 1.3; }
		.prev b { color: var(--primary-text-color); font-weight: 500; }
		.status { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 10px 14px; border-radius: 12px; border: 1px solid var(--divider-color, rgba(0,0,0,0.12)); }
		.status ha-icon { --mdc-icon-size: 28px; color: var(--secondary-text-color); flex: none; }
		.status.active { border-color: var(--primary-color); }
		.status.active ha-icon { color: var(--primary-color); }
		.status.paused { border-color: var(--warning-color, #ffa600); }
		.status.paused ha-icon { color: var(--warning-color, #ffa600); }
		.status .big { font-size: 1.0625rem; font-weight: 500; color: var(--primary-text-color); line-height: 1.3; }
		.status .small { font-size: 0.875rem; color: var(--secondary-text-color); line-height: 1.3; }
		.label { font-size: 0.8125rem; font-weight: 500; color: var(--secondary-text-color); margin: 14px 0 6px; letter-spacing: 0.02em; }
		.row { display: grid; gap: 8px; margin-top: 12px; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
		.btn {
			appearance: none; -webkit-appearance: none; font: inherit; cursor: pointer; margin: 0;
			min-height: 48px; padding: 6px 10px; border-radius: 12px; border: 1px solid var(--primary-color);
			background: transparent; color: var(--primary-color); font-weight: 500;
			display: flex; align-items: center; justify-content: center; gap: 8px;
			-webkit-tap-highlight-color: transparent;
		}
		.btn.fill { background: var(--primary-color); color: var(--text-primary-color, #fff); }
		.btn.quiet { border-color: var(--divider-color, rgba(0,0,0,0.12)); color: var(--secondary-text-color); }
		.btn.done { background: var(--success-color, #43a047); border-color: var(--success-color, #43a047); color: var(--text-primary-color, #fff); }
		.btn:disabled { opacity: 0.45; cursor: default; }
		.btn:focus-visible { outline: 2px solid var(--primary-text-color); outline-offset: 2px; }
		.btn ha-icon { --mdc-icon-size: 20px; }
		.field { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
		.fields { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
		input[type="time"], input[type="datetime-local"], input[type="text"] {
			font: inherit; width: 100%; box-sizing: border-box; margin: 0; min-height: 44px;
			padding: 8px 12px; border-radius: 10px;
			border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
			background: var(--card-background-color, #fff); color: var(--primary-text-color);
		}
		input:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; border-color: var(--primary-color); }
		input:disabled { opacity: 0.5; }
		details { margin-top: 14px; border-top: 1px solid var(--divider-color, rgba(0,0,0,0.12)); padding-top: 4px; }
		summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; gap: 8px; color: var(--primary-text-color); font-weight: 500; list-style: none; }
		summary::-webkit-details-marker { display: none; }
		summary ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); display: inline-flex; transition: transform 150ms; }
		details[open] summary ha-icon { transform: rotate(90deg); }
		.hint { font-size: 0.8125rem; color: var(--secondary-text-color); margin-top: 6px; line-height: 1.4; }
		.error {
			margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 0.875rem; line-height: 1.4;
			background: var(--error-color, #db4437); color: var(--text-primary-color, #fff);
		}
		.warn {
			margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 0.875rem; line-height: 1.4;
			border: 1px solid var(--warning-color, #ffa600); color: var(--primary-text-color);
		}
		[hidden] { display: none !important; }
	`;

	class HuckleberrySleepCard extends HTMLElement {
		static getConfigElement() {
			return document.createElement( EDITOR );
		}

		static getStubConfig( hass ) {
			const entity = hass && hass.states
				? Object.keys( hass.states ).find( ( id ) => /^sensor\..*_sleep$/.test( id ) )
				: undefined;
			return { sleep_entity: entity || 'sensor.child_sleep' };
		}

		constructor() {
			super();
			this.attachShadow( { mode: 'open' } );
			this._config = null;
			this._hass = null;
			this._busy = '';
			this._done = '';
			this._error = '';
			this._formError = '';
			this._logStart = '';
			this._logEnd = '';
			this._logNote = '';
			this._deviceId = undefined;
			this._lookupFor = '';
			this._built = false;
			this._tick = null;
		}

		setConfig( config ) {
			if ( ! config || ! config.sleep_entity ) {
				throw new Error( 'sleep_entity is required: the child\'s sleep sensor, such as sensor.<child>_sleep.' );
			}
			this._config = { ...config };
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
				this._tick = setInterval( () => this._renderStatus(), TICK_MS );
			}
		}

		disconnectedCallback() {
			clearInterval( this._tick );
			this._tick = null;
		}

		getCardSize() {
			return 5;
		}

		getGridOptions() {
			return { columns: 12, min_columns: 6, rows: 'auto' };
		}

		/* ---- lookups --------------------------------------------------------------------- */

		_lookupKey() {
			return [ this._config.sleep_entity, this._config.huckleberry_device_id ].join( '|' );
		}

		async _lookup() {
			const key = this._lookupKey();
			this._lookupFor = key;
			this._deviceId = this._config.huckleberry_device_id || undefined;
			if ( this._deviceId || ! this._hass.callWS ) {
				return;
			}
			try {
				const reg = await this._hass.callWS( { type: 'config/entity_registry/get', entity_id: this._config.sleep_entity } );
				if ( this._lookupFor === key && reg && reg.device_id ) {
					this._deviceId = reg.device_id;
				}
			} catch {
				// No registry record: the error shows on the first tap.
			}
		}

		_state() {
			return this._hass && this._hass.states ? this._hass.states[ this._config.sleep_entity ] : undefined;
		}

		_sleep() {
			return sleepFrom( this._state() );
		}

		_times() {
			return supportsTimes( this._hass && this._hass.services, this._config.integration_version );
		}

		/* ---- actions --------------------------------------------------------------------- */

		async _run( what, build ) {
			if ( this._busy ) {
				return;
			}
			this._error = '';
			this._done = '';
			this._busy = what;
			this._render();
			try {
				const call = build();
				try {
					await this._hass.callService( call.domain, call.service, call.data );
				} catch ( err ) {
					throw new Error( 'Huckleberry did not do it: ' + errorText( err, 'unknown error' ) );
				}
				this._busy = '';
				this._done = what;
				clearTimeout( this._doneTimer );
				this._doneTimer = setTimeout( () => {
					this._done = '';
					this._render();
				}, DONE_FOR );
				return true;
			} catch ( err ) {
				this._busy = '';
				this._error = errorText( err, 'Could not do that.' );
				return false;
			} finally {
				this._render();
			}
		}

		_onStart() {
			this._run( 'start', () => startCall( this._deviceId ) );
		}

		_onPause() {
			this._run( 'pause', () => sleepCall( 'pause_sleep', this._deviceId ) );
		}

		_onResume() {
			this._run( 'resume', () => sleepCall( 'resume_sleep', this._deviceId ) );
		}

		_onComplete() {
			this._run( 'complete', () => sleepCall( 'complete_sleep', this._deviceId ) );
		}

		_onCancel() {
			this._run( 'cancel', () => sleepCall( 'cancel_sleep', this._deviceId ) );
		}

		/** The "started at" box changed on a running timer: start_sleep with the new start moves it. */
		_onStartedAt( value ) {
			const sleep = this._sleep();
			if ( sleep.status !== 'active' && sleep.status !== 'paused' ) {
				return;
			}
			const ms = timeOnDay( value, sleep.start );
			if ( ! Number.isFinite( ms ) || Math.abs( ms - sleep.start ) < 30000 ) {
				return;
			}
			this._run( 'move', () => startCall( this._deviceId, ms ) );
		}

		async _onLogPast() {
			this._formError = '';
			let call;
			try {
				call = logSleepCall( this._deviceId, parseDatetimeValue( this._logStart ), parseDatetimeValue( this._logEnd ), this._logNote );
			} catch ( err ) {
				this._formError = errorText( err, 'Check the times.' );
				this._renderForm();
				return;
			}
			const ok = await this._run( 'log', () => call );
			if ( ok ) {
				this._logStart = '';
				this._logEnd = '';
				this._logNote = '';
				this._renderForm();
			}
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
							<div class="prev"></div>
						</div>
						<div class="status"><ha-icon></ha-icon><div><div class="big"></div><div class="small"></div></div></div>
						<div class="row buttons"></div>
						<div class="started">
							<div class="label">Started at</div>
							<input type="time" aria-label="Started at">
							<div class="hint">Change it to correct when the sleep began.</div>
						</div>
						<div class="message"></div>
						<details class="past">
							<summary><ha-icon icon="mdi:chevron-right"></ha-icon><span>Log a past sleep</span></summary>
							<div class="fields">
								<label class="field"><span class="label">Fell asleep</span><input type="datetime-local" class="log-start"></label>
								<label class="field"><span class="label">Woke up</span><input type="datetime-local" class="log-end"></label>
							</div>
							<div class="label">Note</div>
							<input type="text" class="log-note" placeholder="Optional">
							<div class="row"><button type="button" class="btn fill log"></button></div>
							<div class="form-message"></div>
						</details>
						<div class="needs"></div>
					</ha-card>
				`;
				const q = ( s ) => root.querySelector( s );
				this._el = {
					title: q( '.title' ), prev: q( '.prev' ), status: q( '.status' ), icon: q( '.status ha-icon' ),
					big: q( '.big' ), small: q( '.small' ), buttons: q( '.buttons' ),
					started: q( '.started' ), startedInput: q( '.started input' ), message: q( '.message' ),
					past: q( '.past' ), logStart: q( '.log-start' ), logEnd: q( '.log-end' ), logNote: q( '.log-note' ),
					log: q( '.log' ), formMessage: q( '.form-message' ), needs: q( '.needs' ),
				};
				this._el.startedInput.addEventListener( 'change', () => this._onStartedAt( this._el.startedInput.value ) );
				this._el.logStart.addEventListener( 'change', () => {
					this._logStart = this._el.logStart.value;
					if ( ! this._logEnd && this._logStart ) {
						this._logEnd = datetimeValue( Math.min( Date.now(), parseDatetimeValue( this._logStart ) + 3600000 ) );
					}
					this._renderForm();
				} );
				this._el.logEnd.addEventListener( 'change', () => {
					this._logEnd = this._el.logEnd.value;
					this._renderForm();
				} );
				this._el.logNote.addEventListener( 'input', () => {
					this._logNote = this._el.logNote.value;
				} );
				this._el.log.addEventListener( 'click', () => this._onLogPast() );
				this._built = true;
			}
			this._el.title.textContent = this._config.child_name || this._childName();
			this._renderPrevious();
			this._renderStatus();
			this._renderButtons();
			this._renderForm();
			this._renderNeeds();
			this._el.message.innerHTML = this._error ? '<div class="error" role="alert">' + escapeHtml( this._error ) + '</div>' : '';
		}

		_childName() {
			const st = this._state();
			const friendly = st && st.attributes && st.attributes.friendly_name;
			if ( friendly ) {
				return String( friendly ).replace( /\s+sleep$/i, '' ).trim() || friendly;
			}
			const id = String( this._config.sleep_entity ).split( '.' )[ 1 ] || '';
			return id.replace( /_sleep$/, '' ).replace( /_/g, ' ' ).replace( /\b\w/g, ( c ) => c.toUpperCase() );
		}

		_locale() {
			return this._hass && this._hass.locale && this._hass.locale.language;
		}

		_renderPrevious() {
			const sleep = this._sleep();
			if ( ! this._state() ) {
				this._el.prev.innerHTML = '<b>' + escapeHtml( this._config.sleep_entity ) + '</b><br>not found';
				return;
			}
			if ( ! Number.isFinite( sleep.previousStart ) ) {
				this._el.prev.innerHTML = 'Previous sleep<br><b>none yet</b>';
				return;
			}
			const dur = durationText( sleep.previousDuration );
			this._el.prev.innerHTML = 'Previous sleep' + ( dur ? ' · <b>' + escapeHtml( dur ) + '</b>' : '' )
				+ '<br>' + escapeHtml( clock( sleep.previousStart, this._locale() ) ) + ' · ' + escapeHtml( relative( sleep.previousStart ) );
		}

		_renderStatus() {
			if ( ! this._el ) {
				return;
			}
			const sleep = this._sleep();
			const el = this._el;
			el.status.classList.toggle( 'active', sleep.status === 'active' );
			el.status.classList.toggle( 'paused', sleep.status === 'paused' );
			const at = clock( sleep.start, this._locale() );
			const el2 = durationText( elapsed( sleep ) );
			if ( sleep.status === 'active' ) {
				el.icon.setAttribute( 'icon', 'mdi:sleep' );
				el.big.textContent = 'Sleeping since ' + at + ( el2 ? ' (' + el2 + ')' : '' );
				el.small.textContent = 'Timer running';
			} else if ( sleep.status === 'paused' ) {
				el.icon.setAttribute( 'icon', 'mdi:pause-circle-outline' );
				el.big.textContent = 'Paused' + ( Number.isFinite( sleep.end ) ? ' at ' + clock( sleep.end, this._locale() ) : '' ) + ( el2 ? ' · ' + el2 + ' so far' : '' );
				el.small.textContent = 'Fell asleep ' + at;
			} else if ( sleep.status === 'none' ) {
				el.icon.setAttribute( 'icon', 'mdi:white-balance-sunny' );
				el.big.textContent = 'Awake';
				el.small.textContent = 'No sleep timer running';
			} else {
				el.icon.setAttribute( 'icon', 'mdi:help-circle-outline' );
				el.big.textContent = this._state() ? 'Sleep status unknown' : 'Sleep sensor not found';
				el.small.textContent = this._state() ? 'State "' + String( this._state().state ) + '"' : this._config.sleep_entity;
			}
			const running = sleep.status === 'active' || sleep.status === 'paused';
			el.started.hidden = ! ( running && this._times() );
			if ( ! el.started.hidden && document.activeElement !== el.startedInput ) {
				const v = timeValue( sleep.start );
				if ( el.startedInput.value !== v ) {
					el.startedInput.value = v;
				}
			}
			el.startedInput.disabled = !! this._busy;
		}

		_renderButtons() {
			const sleep = this._sleep();
			const wrap = this._el.buttons;
			wrap.innerHTML = '';
			const add = ( what, label, icon, fill, handler ) => {
				const b = document.createElement( 'button' );
				b.type = 'button';
				b.className = 'btn' + ( fill ? ' ' + fill : '' );
				b.dataset.what = what;
				b.disabled = !! this._busy;
				if ( this._busy === what ) {
					b.innerHTML = '<ha-icon icon="mdi:timer-sand"></ha-icon><span>Working…</span>';
				} else if ( this._done === what ) {
					b.classList.add( 'done' );
					b.innerHTML = '<ha-icon icon="mdi:check"></ha-icon><span>Done</span>';
				} else {
					b.innerHTML = '<ha-icon icon="' + icon + '"></ha-icon><span>' + escapeHtml( label ) + '</span>';
				}
				b.addEventListener( 'click', handler );
				wrap.appendChild( b );
			};
			if ( sleep.status === 'active' ) {
				add( 'pause', 'Pause', 'mdi:pause', '', () => this._onPause() );
				add( 'complete', 'Complete', 'mdi:check', 'fill', () => this._onComplete() );
				add( 'cancel', 'Cancel timer', 'mdi:close', 'quiet', () => this._onCancel() );
			} else if ( sleep.status === 'paused' ) {
				add( 'resume', 'Resume', 'mdi:play', '', () => this._onResume() );
				add( 'complete', 'Complete', 'mdi:check', 'fill', () => this._onComplete() );
				add( 'cancel', 'Cancel timer', 'mdi:close', 'quiet', () => this._onCancel() );
			} else {
				add( 'start', 'Start sleep', 'mdi:sleep', 'fill', () => this._onStart() );
			}
			if ( this._done === 'move' ) {
				this._el.message.innerHTML = '';
			}
		}

		_renderForm() {
			if ( ! this._el ) {
				return;
			}
			const el = this._el;
			const show = this._config.log_form !== false && this._times();
			el.past.hidden = ! show;
			if ( ! show ) {
				return;
			}
			if ( el.logStart.value !== this._logStart ) {
				el.logStart.value = this._logStart;
			}
			if ( el.logEnd.value !== this._logEnd ) {
				el.logEnd.value = this._logEnd;
			}
			if ( el.logNote.value !== this._logNote ) {
				el.logNote.value = this._logNote;
			}
			const max = datetimeValue( Date.now() );
			el.logStart.max = max;
			el.logEnd.max = max;
			for ( const i of [ el.logStart, el.logEnd, el.logNote ] ) {
				i.disabled = !! this._busy;
			}
			const start = parseDatetimeValue( this._logStart );
			const end = parseDatetimeValue( this._logEnd );
			const ready = Number.isFinite( start ) && Number.isFinite( end ) && end > start;
			el.log.disabled = !! this._busy || ! ready;
			el.log.classList.toggle( 'done', this._done === 'log' );
			if ( this._busy === 'log' ) {
				el.log.innerHTML = '<ha-icon icon="mdi:timer-sand"></ha-icon><span>Logging…</span>';
			} else if ( this._done === 'log' ) {
				el.log.innerHTML = '<ha-icon icon="mdi:check"></ha-icon><span>Logged</span>';
			} else {
				el.log.innerHTML = '<ha-icon icon="mdi:check"></ha-icon><span>' + ( ready ? 'Log ' + escapeHtml( durationText( end - start ) ) + ' of sleep' : 'Log sleep' ) + '</span>';
			}
			el.formMessage.innerHTML = this._formError ? '<div class="error" role="alert">' + escapeHtml( this._formError ) + '</div>' : '';
		}

		_renderNeeds() {
			const services = this._hass && this._hass.services;
			if ( ! hasSleepActions( services ) && ! this._config.integration_version ) {
				this._el.needs.innerHTML = '<div class="warn">The Huckleberry integration\'s sleep actions (huckleberry.start_sleep…) are not in this Home Assistant. Install Woyken\'s Huckleberry integration, or set integration_version if the card cannot see them.</div>';
				return;
			}
			if ( ! this._times() ) {
				this._el.needs.innerHTML = '<div class="warn">Correcting the start time and logging a past sleep need Huckleberry integration ' + NEEDS_VERSION
					+ ' or later (update it in HACS, then restart Home Assistant). Those controls are hidden until then.</div>';
				return;
			}
			this._el.needs.innerHTML = '';
		}
	}

	function escapeHtml( s ) {
		return String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );
	}

	/* ---- A small config editor for the card picker -------------------------------------- */

	class HuckleberrySleepCardEditor extends HTMLElement {
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
		{ name: 'sleep_entity', required: true, selector: { entity: { domain: 'sensor' } } },
		{ name: 'child_name', selector: { text: {} } },
		{ name: 'huckleberry_device_id', selector: { device: { integration: 'huckleberry' } } },
		{ name: 'integration_version', selector: { text: {} } },
		{ name: 'log_form', selector: { boolean: {} } },
	];
	const LABELS = {
		sleep_entity: 'Sleep sensor',
		child_name: 'Child\'s name',
		huckleberry_device_id: 'Huckleberry child device',
		integration_version: 'Integration version',
		log_form: 'Show "Log a past sleep"',
	};
	const HELPERS = {
		sleep_entity: 'The child\'s sleep status sensor from the Huckleberry integration, sensor.<child>_sleep.',
		child_name: 'Shown as the title. Default: from the sensor\'s name.',
		huckleberry_device_id: 'Default: the device that owns the sleep sensor.',
		integration_version: 'Default: read from the actions. Set 0.5.6 to force the start-time controls on, or 0.5.5 to hide them.',
		log_form: 'Default: on (when the integration is 0.5.6 or later).',
	};

	if ( ! customElements.get( CARD ) ) {
		customElements.define( CARD, HuckleberrySleepCard );
	}
	if ( ! customElements.get( EDITOR ) ) {
		customElements.define( EDITOR, HuckleberrySleepCardEditor );
	}
	window.customCards = window.customCards || [];
	if ( ! window.customCards.some( ( c ) => c.type === CARD ) ) {
		window.customCards.push( {
			type: CARD,
			name: 'Huckleberry sleep card',
			description: 'Start, pause and complete the Huckleberry sleep timer, fix its start, log a past sleep.',
			preview: false,
			documentationURL: 'https://github.com/trevorbicewebdesign/huckleberry-dashboard',
		} );
	}

	// For tests (Node/jsdom): the pure logic, without touching the page.
	const logic = {
		NEEDS_VERSION, parseWhen, parseDuration, sleepFrom, elapsed, durationText, compareVersions, supportsTimes, hasSleepActions,
		isoWithOffset, sleepCall, startCall, logSleepCall, timeValue, datetimeValue, parseDatetimeValue, timeOnDay, errorText, relative,
	};
	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = logic;
	}
	window.__huckleberrySleepCardLogic = logic;
} )();
