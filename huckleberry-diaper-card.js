/**
 * Huckleberry diaper card — a Home Assistant custom card.
 *
 * Logs a diaper change in Huckleberry (Woyken's integration, actions huckleberry.log_diaper_*)
 * and takes one diaper from a Home Gnome place (home_gnome.use_one). One file, no build step.
 *
 * Config (YAML):
 *   type: custom:huckleberry-diaper-card
 *   diaper_entity: sensor.<child>_diaper       # required: the child's "last diaper" sensor
 *   child_name: <name>                         # default: from the entity's friendly name
 *   huckleberry_device_id: <device id>         # default: the device that owns diaper_entity
 *   home_gnome_entry_id: <config entry id>     # default: the single home_gnome entry
 *   diaper_entry_id: <inventory id>            # a Home Gnome inventory entry of the diaper item
 *   diaper_item_id: <known item id>            # or the known item id (used when no entry id)
 *   default_location_id: <location id>         # the place preselected in "Take one from"
 *   default_location: <place name>             # or by path text (matched case-insensitively)
 *   script: script.<your script>               # optional: called instead of the actions, with
 *                                              # kind, pee_amount, poo_amount, diaper_rash, notes
 *
 * The card keeps a global here only to register with the card picker.
 */
( () => {
	'use strict';

	const CARD = 'huckleberry-diaper-card';
	const EDITOR = 'huckleberry-diaper-card-editor';

	const KINDS = [
		{ id: 'pee', label: 'Pee', icon: 'mdi:water', action: 'log_diaper_pee', sizes: [ 'pee' ] },
		{ id: 'poo', label: 'Poo', icon: 'mdi:emoticon-poop', action: 'log_diaper_poo', sizes: [ 'poo' ] },
		{ id: 'mixed', label: 'Mixed', icon: 'mdi:water-sync', action: 'log_diaper_both', sizes: [ 'pee', 'poo' ] },
		{ id: 'dry', label: 'Dry', icon: 'mdi:weather-sunny', action: 'log_diaper_dry', sizes: [] },
	];
	const SIZES = [
		{ id: 'small', label: 'Small', amount: 'little' },
		{ id: 'medium', label: 'Medium', amount: 'medium' },
		{ id: 'large', label: 'Large', amount: 'big' },
	];
	const SIZE_LABELS = { pee: 'Pee', poo: 'Poo' };
	const NONE = '';
	const LOGGED_FOR = 2500;

	/* ---- Pure logic (also what tests/check.js exercises) --------------------------------- */

	/** Which size rows a kind shows: [] for dry, ['pee'] / ['poo'], ['pee','poo'] for mixed. */
	function sizeRowsFor( kind ) {
		const k = KINDS.find( ( x ) => x.id === kind );
		return k ? k.sizes.slice() : [];
	}

	/** Whether Log may be pressed: a kind, and a size for every row that kind shows. */
	function canLog( kind, sizes ) {
		if ( ! kind ) {
			return false;
		}
		return sizeRowsFor( kind ).every( ( row ) => !! ( sizes && sizes[ row ] ) );
	}

	/**
	 * The Huckleberry action and its data for a change. Amounts only when chosen, notes only when
	 * typed, diaper_rash only when ticked (every kind takes it).
	 */
	function huckleberryCall( kind, sizes, note, deviceId, rash ) {
		const k = KINDS.find( ( x ) => x.id === kind );
		if ( ! k ) {
			throw new Error( 'Pick what kind of change it was.' );
		}
		const data = { device_id: deviceId };
		for ( const row of k.sizes ) {
			const size = SIZES.find( ( s ) => s.id === ( sizes && sizes[ row ] ) );
			if ( size ) {
				data[ row + '_amount' ] = size.amount;
			}
		}
		if ( rash ) {
			data.diaper_rash = true;
		}
		const text = ( note || '' ).trim();
		if ( text ) {
			data.notes = text;
		}
		return { domain: 'huckleberry', service: k.action, data };
	}

	/** The saved script's data (kind/pee_amount/poo_amount/diaper_rash/notes; each only when it applies). */
	function scriptCall( script, kind, sizes, note, rash ) {
		const call = huckleberryCall( kind, sizes, note, undefined, rash );
		const data = { kind: kind === 'mixed' ? 'both' : kind };
		for ( const key of [ 'pee_amount', 'poo_amount', 'diaper_rash', 'notes' ] ) {
			if ( call.data[ key ] !== undefined ) {
				data[ key ] = call.data[ key ];
			}
		}
		const [ domain, service ] = splitScript( script );
		return { domain, service, data };
	}

	function splitScript( script ) {
		const s = String( script || '' );
		const dot = s.indexOf( '.' );
		if ( dot < 0 ) {
			return [ 'script', s ];
		}
		return [ s.slice( 0, dot ), s.slice( dot + 1 ) ];
	}

	/**
	 * The places that hold the diaper item: one option per entry with something in it, in the
	 * order the server lists the item's entries. Takes GET inventory/{id}'s answer (`item.entries`)
	 * or GET items/{id}'s (`entries`). A place is `{ id: <entry id>, location, path, label, quantity }`.
	 */
	function placesFrom( answer ) {
		const item = answer && answer.item && typeof answer.item === 'object' ? answer.item : answer;
		const entries = item && Array.isArray( item.entries ) ? item.entries : [];
		return entries
			.filter( ( e ) => e && typeof e.id === 'number' && Number( e.quantity ) > 0 && ! e.missing )
			.map( ( e ) => ( {
				id: e.id,
				location: e.location,
				path: e.location_path || '',
				label: lastSegment( e.location_path ) || ( 'Entry ' + e.id ),
				quantity: Number( e.quantity ),
				variant: e.variant || '',
			} ) );
	}

	function lastSegment( path ) {
		const parts = String( path || '' ).split( '›' ).map( ( p ) => p.trim() ).filter( Boolean );
		return parts.length ? parts[ parts.length - 1 ] : '';
	}

	/** Which place to preselect: by entry id, by location id, by path text, else the first. */
	function defaultPlace( places, config ) {
		if ( ! places.length ) {
			return NONE;
		}
		const byEntry = config.diaper_entry_id && places.find( ( p ) => p.id === Number( config.diaper_entry_id ) );
		if ( config.default_location_id !== undefined && config.default_location_id !== null ) {
			const found = places.find( ( p ) => p.location === Number( config.default_location_id ) );
			if ( found ) {
				return String( found.id );
			}
		}
		if ( config.default_location ) {
			const text = String( config.default_location ).toLowerCase();
			const found = places.find( ( p ) => p.label.toLowerCase() === text )
				|| places.find( ( p ) => p.path.toLowerCase() === text )
				|| places.find( ( p ) => p.path.toLowerCase().includes( text ) );
			if ( found ) {
				return String( found.id );
			}
		}
		if ( byEntry ) {
			return String( byEntry.id );
		}
		return String( places[ 0 ].id );
	}

	/** Words for an error from hass.callService / callApi / callWS. */
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

	/** "2 h ago" style for the last change. */
	function relative( iso, now ) {
		const then = Date.parse( iso );
		if ( Number.isNaN( then ) ) {
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

	function clock( iso, locale ) {
		const t = Date.parse( iso );
		if ( Number.isNaN( t ) ) {
			return '';
		}
		try {
			return new Date( t ).toLocaleTimeString( locale || undefined, { hour: 'numeric', minute: '2-digit' } );
		} catch {
			return new Date( t ).toTimeString().slice( 0, 5 );
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
		.label:first-of-type { margin-top: 0; }
		.row { display: grid; gap: 8px; }
		.row.kinds { grid-template-columns: repeat(4, minmax(0, 1fr)); }
		.row.sizes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
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
		.choice[aria-pressed="true"] {
			background: var(--primary-color); border-color: var(--primary-color);
			color: var(--text-primary-color, #fff);
		}
		.choice:disabled { opacity: 0.5; cursor: default; }
		textarea, select {
			font: inherit; width: 100%; box-sizing: border-box; margin: 0;
			padding: 10px 12px; border-radius: 10px; min-height: 44px;
			border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
			background: var(--card-background-color, #fff);
			color: var(--primary-text-color);
		}
		textarea { resize: vertical; min-height: 56px; }
		textarea::placeholder { color: var(--secondary-text-color); opacity: 0.8; }
		select { appearance: auto; }
		textarea:focus, select:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; border-color: var(--primary-color); }
		.check {
			display: flex; align-items: center; gap: 10px; min-height: 44px; margin-top: 4px;
			cursor: pointer; color: var(--primary-text-color); font-size: 0.9375rem; user-select: none;
		}
		.check input { width: 20px; height: 20px; margin: 0; accent-color: var(--primary-color); cursor: pointer; }
		.hint { font-size: 0.8125rem; color: var(--secondary-text-color); margin-top: 6px; }
		.log {
			appearance: none; -webkit-appearance: none; font: inherit; cursor: pointer; margin: 16px 0 0;
			width: 100%; min-height: 48px; border-radius: 12px; border: 0;
			background: var(--primary-color); color: var(--text-primary-color, #fff);
			font-size: 1rem; font-weight: 500; letter-spacing: 0.02em;
			display: flex; align-items: center; justify-content: center; gap: 8px;
		}
		.log:disabled { opacity: 0.45; cursor: default; }
		.log.done { background: var(--success-color, #43a047); }
		.log:focus-visible { outline: 2px solid var(--primary-text-color); outline-offset: 2px; }
		.error {
			margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 0.875rem; line-height: 1.4;
			background: var(--error-color, #db4437); color: var(--text-primary-color, #fff);
		}
		.warn {
			margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 0.875rem; line-height: 1.4;
			border: 1px solid var(--warning-color, #ffa600); color: var(--primary-text-color);
		}
	`;

	class HuckleberryDiaperCard extends HTMLElement {
		static getConfigElement() {
			return document.createElement( EDITOR );
		}

		static getStubConfig( hass ) {
			const entity = hass && hass.states
				? Object.keys( hass.states ).find( ( id ) => /^sensor\..*_diaper$/.test( id ) )
				: undefined;
			return { diaper_entity: entity || 'sensor.child_diaper', diaper_entry_id: 1 };
		}

		constructor() {
			super();
			this.attachShadow( { mode: 'open' } );
			this._config = null;
			this._hass = null;
			this._kind = '';
			this._sizes = {};
			this._note = '';
			this._rash = false;
			this._place = undefined; // undefined = not chosen yet (take the default), '' = don't take one
			this._places = [];
			this._placesError = '';
			this._placesLoading = false;
			this._busy = false;
			this._error = '';
			this._logged = false;
			this._deviceId = undefined;
			this._entryId = undefined;
			this._lookupsFor = '';
			this._built = false;
		}

		setConfig( config ) {
			if ( ! config || ! config.diaper_entity ) {
				throw new Error( 'diaper_entity is required: the child\'s "last diaper" sensor, such as sensor.<child>_diaper.' );
			}
			if ( ! config.diaper_entry_id && ! config.diaper_item_id ) {
				throw new Error( 'Give diaper_entry_id (a Home Gnome inventory entry of the diapers) or diaper_item_id (the known item).' );
			}
			this._config = { ...config };
			this._lookupsFor = '';
			this._places = [];
			this._place = undefined;
			this._render();
			if ( this._hass ) {
				this._lookups();
			}
		}

		set hass( hass ) {
			const first = ! this._hass;
			this._hass = hass;
			if ( ! this._config ) {
				return;
			}
			if ( first || this._lookupsFor !== this._lookupKey() ) {
				this._lookups();
			}
			this._renderLast();
		}

		get hass() {
			return this._hass;
		}

		getCardSize() {
			return 7;
		}

		getGridOptions() {
			return { columns: 12, min_columns: 6, rows: 'auto' };
		}

		/* ---- lookups: device id, config entry id, places ---------------------------------- */

		_lookupKey() {
			const c = this._config || {};
			return [ c.diaper_entity, c.huckleberry_device_id, c.home_gnome_entry_id, c.diaper_entry_id, c.diaper_item_id ].join( '|' );
		}

		async _lookups() {
			const key = this._lookupKey();
			this._lookupsFor = key;
			this._deviceId = this._config.huckleberry_device_id || undefined;
			this._entryId = this._config.home_gnome_entry_id || undefined;
			const jobs = [];
			if ( ! this._deviceId && ! this._config.script ) {
				jobs.push( this._findDevice().catch( () => undefined ) );
			}
			if ( ! this._entryId ) {
				jobs.push( this._findEntry().catch( () => undefined ) );
			}
			await Promise.all( jobs );
			if ( this._lookupsFor !== key ) {
				return;
			}
			await this._loadPlaces();
		}

		async _findDevice() {
			const reg = await this._hass.callWS( { type: 'config/entity_registry/get', entity_id: this._config.diaper_entity } );
			if ( reg && reg.device_id ) {
				this._deviceId = reg.device_id;
			}
		}

		async _findEntry() {
			let entries = [];
			try {
				entries = await this._hass.callWS( { type: 'config_entries/get', domain: 'home_gnome' } );
			} catch {
				// Not an admin: config_entries/get is refused. Any home_gnome entity knows its entry.
				const list = await this._hass.callWS( { type: 'config/entity_registry/list' } );
				const ids = new Set( ( list || [] ).filter( ( e ) => e.platform === 'home_gnome' && e.config_entry_id ).map( ( e ) => e.config_entry_id ) );
				entries = [ ...ids ].map( ( id ) => ( { entry_id: id } ) );
			}
			const loaded = ( entries || [] ).filter( ( e ) => ! e.state || e.state === 'loaded' );
			if ( loaded.length === 1 ) {
				this._entryId = loaded[ 0 ].entry_id;
			} else if ( loaded.length > 1 ) {
				throw new Error( 'More than one Home Gnome server is set up: say which with home_gnome_entry_id.' );
			}
		}

		async _loadPlaces() {
			const key = this._lookupsFor;
			this._placesError = '';
			if ( ! this._entryId ) {
				this._placesError = 'No Home Gnome server found: set home_gnome_entry_id to the integration\'s config entry id.';
				this._places = [];
				this._renderPlaces();
				return;
			}
			this._placesLoading = true;
			this._renderPlaces();
			try {
				const answer = await this._fetchItem();
				if ( this._lookupsFor !== key ) {
					return;
				}
				this._places = placesFrom( answer );
				if ( this._place === undefined || ( this._place !== NONE && ! this._places.some( ( p ) => String( p.id ) === this._place ) ) ) {
					this._place = defaultPlace( this._places, this._config );
				}
				if ( ! this._places.length ) {
					this._placesError = 'Home Gnome has no diapers anywhere.';
				}
			} catch ( err ) {
				if ( this._lookupsFor !== key ) {
					return;
				}
				this._places = [];
				this._placesError = this._placesWords( err );
			} finally {
				this._placesLoading = false;
			}
			this._renderPlaces();
		}

		/**
		 * The diaper item with its entries, through the integration's proxy (`/api/home_gnome/<entry>/api/v1/…`),
		 * as the signed-in user's linked person: GET inventory/{entry} (its `item.entries` lists every
		 * entry of the item) or, by known item, GET items/{item}.
		 */
		async _fetchItem() {
			const root = 'home_gnome/' + encodeURIComponent( this._entryId ) + '/api/v1/';
			if ( this._config.diaper_entry_id ) {
				return this._hass.callApi( 'GET', root + 'inventory/' + encodeURIComponent( this._config.diaper_entry_id ) );
			}
			return this._hass.callApi( 'GET', root + 'items/' + encodeURIComponent( this._config.diaper_item_id ) );
		}

		_placesWords( err ) {
			const code = err && err.body && err.body.code;
			const status = err && ( err.status_code || err.status );
			if ( code === 'home_gnome_not_linked' || status === 403 && /linked/i.test( errorText( err, '' ) ) ) {
				return 'You are not linked to a Home Gnome person, so the places cannot be listed. An admin links you on the Home Gnome card in Settings › Devices & services.';
			}
			if ( status === 404 && ( code === 'rest_no_route' || code === 'home_gnome_no_server' || code === 'home_gnome_not_found' || code === 'house_ledger_not_found' ) ) {
				return 'Home Gnome did not find the diaper entry (' + ( this._config.diaper_entry_id || this._config.diaper_item_id ) + '): ' + errorText( err, 'not found' ) + '. Its id may have changed; open the entry in Home Gnome and read the id from its address.';
			}
			if ( code === 'home_gnome_unavailable' ) {
				return 'Home Gnome is not set up in Home Assistant right now (its integration entry is not loaded). Reload it under Settings › Devices & services.';
			}
			if ( status === 404 ) {
				return 'Home Gnome\'s API is not reachable through Home Assistant (404' + ( code ? ' ' + code : '' ) + '): ' + errorText( err, 'no detail' ) + '. Check home_gnome_entry_id.';
			}
			return 'Could not list the places with diapers (' + ( status || '?' ) + ( code ? ' ' + code : '' ) + '): ' + errorText( err, 'unknown error' );
		}

		/* ---- logging ---------------------------------------------------------------------- */

		async _log() {
			if ( this._busy || ! canLog( this._kind, this._sizes ) ) {
				return;
			}
			this._error = '';
			this._logged = false;
			this._busy = true;
			this._renderControls();
			const kind = this._kind;
			const sizes = { ...this._sizes };
			const note = this._note;
			const rash = this._rash;
			const place = this._place;
			try {
				if ( this._config.script ) {
					const call = scriptCall( this._config.script, kind, sizes, note, rash );
					await this._hass.callService( call.domain, call.service, call.data );
				} else {
					if ( ! this._deviceId ) {
						throw new Error( 'No Huckleberry device for ' + this._config.diaper_entity + ': set huckleberry_device_id, or script.' );
					}
					const call = huckleberryCall( kind, sizes, note, this._deviceId, rash );
					try {
						await this._hass.callService( call.domain, call.service, call.data );
					} catch ( err ) {
						throw new Error( 'Huckleberry did not log it: ' + errorText( err, 'unknown error' ) );
					}
				}
			} catch ( err ) {
				this._error = errorText( err, 'Could not log it.' );
				this._busy = false;
				this._renderControls();
				return;
			}
			// Logged in Huckleberry: the form clears whatever happens with the diaper.
			this._kind = '';
			this._sizes = {};
			this._note = '';
			this._rash = false;
			if ( place && place !== NONE ) {
				try {
					await this._hass.callService( 'home_gnome', 'use_one', {
						inventory_id: Number( place ),
						...( this._entryId ? { config_entry_id: this._entryId } : {} ),
					} );
				} catch ( err ) {
					const p = this._places.find( ( x ) => String( x.id ) === place );
					this._error = 'Logged in Huckleberry, but no diaper was taken' + ( p ? ' from ' + p.label : '' ) + ': ' + errorText( err, 'unknown error' );
				}
			}
			this._busy = false;
			this._logged = ! this._error;
			this._renderControls();
			if ( this._logged ) {
				clearTimeout( this._loggedTimer );
				this._loggedTimer = setTimeout( () => {
					this._logged = false;
					this._renderControls();
				}, LOGGED_FOR );
			}
			await this._loadPlaces();
		}

		/* ---- rendering -------------------------------------------------------------------- */

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
						<div class="label">What kind of change?</div>
						<div class="row kinds" role="group" aria-label="Kind"></div>
						<div class="sizes-wrap"></div>
						<div class="label">Note</div>
						<textarea rows="2" placeholder="Anything to remember (optional)"></textarea>
						<label class="check"><input type="checkbox" class="rash"><span>Diaper rash</span></label>
						<div class="label">Take one from</div>
						<select aria-label="Take one from"></select>
						<div class="hint places-hint"></div>
						<button class="log" type="button"></button>
						<div class="message"></div>
					</ha-card>
				`;
				this._el = {
					title: root.querySelector( '.title' ),
					last: root.querySelector( '.last' ),
					kinds: root.querySelector( '.kinds' ),
					sizes: root.querySelector( '.sizes-wrap' ),
					note: root.querySelector( 'textarea' ),
					rash: root.querySelector( '.rash' ),
					select: root.querySelector( 'select' ),
					hint: root.querySelector( '.places-hint' ),
					log: root.querySelector( '.log' ),
					message: root.querySelector( '.message' ),
				};
				for ( const k of KINDS ) {
					const b = document.createElement( 'button' );
					b.type = 'button';
					b.className = 'choice';
					b.dataset.kind = k.id;
					b.setAttribute( 'aria-pressed', 'false' );
					b.innerHTML = `<ha-icon icon="${ k.icon }"></ha-icon><span>${ k.label }</span>`;
					b.addEventListener( 'click', () => this._pickKind( k.id ) );
					this._el.kinds.appendChild( b );
				}
				this._el.note.addEventListener( 'input', () => {
					this._note = this._el.note.value;
				} );
				this._el.rash.addEventListener( 'change', () => {
					this._rash = this._el.rash.checked;
				} );
				this._el.select.addEventListener( 'change', () => {
					this._place = this._el.select.value;
				} );
				this._el.log.addEventListener( 'click', () => this._log() );
				this._built = true;
			}
			this._el.title.textContent = this._config.child_name || this._childName();
			this._renderLast();
			this._renderControls();
			this._renderPlaces();
		}

		_childName() {
			const st = this._hass && this._hass.states && this._hass.states[ this._config.diaper_entity ];
			const friendly = st && st.attributes && st.attributes.friendly_name;
			if ( friendly ) {
				return String( friendly ).replace( /\s+diaper$/i, '' ).trim() || friendly;
			}
			const id = String( this._config.diaper_entity ).split( '.' )[ 1 ] || '';
			return id.replace( /_diaper$/, '' ).replace( /_/g, ' ' ).replace( /\b\w/g, ( c ) => c.toUpperCase() );
		}

		_renderLast() {
			if ( ! this._el ) {
				return;
			}
			if ( this._config.child_name === undefined ) {
				this._el.title.textContent = this._childName();
			}
			const st = this._hass && this._hass.states && this._hass.states[ this._config.diaper_entity ];
			if ( ! st ) {
				this._el.last.innerHTML = '<b>' + escapeHtml( this._config.diaper_entity ) + '</b><br>not found';
				return;
			}
			if ( st.state === 'unknown' || st.state === 'unavailable' || ! st.state ) {
				this._el.last.innerHTML = 'Last change<br><b>none yet</b>';
				return;
			}
			const type = st.attributes && st.attributes.type ? String( st.attributes.type ) : '';
			const locale = this._hass && this._hass.locale && this._hass.locale.language;
			const at = clock( st.state, locale );
			this._el.last.innerHTML = 'Last' + ( type ? ' · ' + escapeHtml( type ) : '' ) + '<br><b>' + escapeHtml( relative( st.state ) ) + '</b>'
				+ ( at ? ' · ' + escapeHtml( at ) : '' );
		}

		_pickKind( id ) {
			if ( this._busy ) {
				return;
			}
			this._kind = this._kind === id ? '' : id;
			// Sizes of rows the new kind no longer shows are dropped; shared ones stay.
			const rows = sizeRowsFor( this._kind );
			for ( const row of Object.keys( this._sizes ) ) {
				if ( ! rows.includes( row ) ) {
					delete this._sizes[ row ];
				}
			}
			this._error = '';
			this._logged = false;
			this._renderControls();
		}

		_pickSize( row, id ) {
			if ( this._busy ) {
				return;
			}
			this._sizes[ row ] = this._sizes[ row ] === id ? undefined : id;
			if ( ! this._sizes[ row ] ) {
				delete this._sizes[ row ];
			}
			this._error = '';
			this._renderControls();
		}

		_renderControls() {
			if ( ! this._el ) {
				return;
			}
			for ( const b of this._el.kinds.querySelectorAll( '.choice' ) ) {
				b.setAttribute( 'aria-pressed', String( b.dataset.kind === this._kind ) );
				b.disabled = this._busy;
			}
			const rows = sizeRowsFor( this._kind );
			const wrap = this._el.sizes;
			wrap.innerHTML = '';
			for ( const row of rows ) {
				const label = document.createElement( 'div' );
				label.className = 'label';
				label.textContent = rows.length > 1 ? SIZE_LABELS[ row ] + ' · how much?' : 'How much?';
				wrap.appendChild( label );
				const grid = document.createElement( 'div' );
				grid.className = 'row sizes';
				grid.setAttribute( 'role', 'group' );
				grid.setAttribute( 'aria-label', SIZE_LABELS[ row ] + ' size' );
				grid.dataset.row = row;
				for ( const s of SIZES ) {
					const b = document.createElement( 'button' );
					b.type = 'button';
					b.className = 'choice';
					b.dataset.size = s.id;
					b.setAttribute( 'aria-pressed', String( this._sizes[ row ] === s.id ) );
					b.disabled = this._busy;
					b.innerHTML = '<span>' + s.label + '</span>';
					b.addEventListener( 'click', () => this._pickSize( row, s.id ) );
					grid.appendChild( b );
				}
				wrap.appendChild( grid );
			}
			if ( this._el.note.value !== this._note ) {
				this._el.note.value = this._note;
			}
			this._el.note.disabled = this._busy;
			if ( this._el.rash.checked !== this._rash ) {
				this._el.rash.checked = this._rash;
			}
			this._el.rash.disabled = this._busy;
			this._el.select.disabled = this._busy || this._placesLoading;
			const log = this._el.log;
			log.disabled = this._busy || ! canLog( this._kind, this._sizes );
			log.classList.toggle( 'done', this._logged );
			if ( this._busy ) {
				log.innerHTML = '<ha-icon icon="mdi:timer-sand"></ha-icon><span>Logging…</span>';
			} else if ( this._logged ) {
				log.innerHTML = '<ha-icon icon="mdi:check"></ha-icon><span>Logged</span>';
			} else if ( ! this._kind ) {
				log.innerHTML = '<span>Log</span>';
			} else if ( ! canLog( this._kind, this._sizes ) ) {
				log.innerHTML = '<span>Pick a size to log</span>';
			} else {
				const k = KINDS.find( ( x ) => x.id === this._kind );
				log.innerHTML = '<ha-icon icon="mdi:check"></ha-icon><span>Log ' + k.label.toLowerCase() + '</span>';
			}
			this._el.message.innerHTML = this._error ? '<div class="error" role="alert">' + escapeHtml( this._error ) + '</div>' : '';
		}

		_renderPlaces() {
			if ( ! this._el ) {
				return;
			}
			const select = this._el.select;
			select.innerHTML = '';
			for ( const p of this._places ) {
				const o = document.createElement( 'option' );
				o.value = String( p.id );
				o.textContent = p.label + ' · ' + p.quantity + ( p.variant ? ' (size ' + p.variant + ')' : '' );
				o.title = p.path;
				select.appendChild( o );
			}
			const none = document.createElement( 'option' );
			none.value = NONE;
			none.textContent = this._places.length ? 'Don\'t take one' : ( this._placesLoading ? 'Looking for diapers…' : 'Don\'t take one' );
			select.appendChild( none );
			const wanted = this._place === undefined || this._place === null ? NONE : String( this._place );
			select.value = wanted;
			if ( select.value !== wanted ) {
				select.value = NONE;
			}
			select.disabled = this._busy || this._placesLoading;
			if ( this._placesError ) {
				this._el.hint.innerHTML = '<div class="warn">' + escapeHtml( this._placesError ) + '</div>';
			} else {
				const p = this._places.find( ( x ) => String( x.id ) === select.value );
				this._el.hint.textContent = p ? p.path : '';
			}
		}
	}

	function escapeHtml( s ) {
		return String( s ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ c ] ) );
	}

	/* ---- A small config editor for the card picker -------------------------------------- */

	class HuckleberryDiaperCardEditor extends HTMLElement {
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
		{ name: 'diaper_entity', required: true, selector: { entity: { domain: 'sensor' } } },
		{ name: 'child_name', selector: { text: {} } },
		{ name: 'diaper_entry_id', selector: { number: { min: 1, mode: 'box' } } },
		{ name: 'diaper_item_id', selector: { number: { min: 1, mode: 'box' } } },
		{ name: 'default_location', selector: { text: {} } },
		{ name: 'default_location_id', selector: { number: { min: 0, mode: 'box' } } },
		{ name: 'home_gnome_entry_id', selector: { config_entry: { integration: 'home_gnome' } } },
		{ name: 'huckleberry_device_id', selector: { device: { integration: 'huckleberry' } } },
		{ name: 'script', selector: { entity: { domain: 'script' } } },
	];
	const LABELS = {
		diaper_entity: 'Diaper sensor',
		child_name: 'Child\'s name',
		diaper_entry_id: 'Home Gnome entry (inventory id)',
		diaper_item_id: 'Home Gnome known item id',
		default_location: 'Default place (name)',
		default_location_id: 'Default place (location id)',
		home_gnome_entry_id: 'Home Gnome server',
		huckleberry_device_id: 'Huckleberry child device',
		script: 'Script to call instead',
	};
	const HELPERS = {
		diaper_entity: 'The child\'s "last diaper" sensor from the Huckleberry integration.',
		child_name: 'Shown as the title. Default: from the sensor\'s name.',
		diaper_entry_id: 'Any one inventory entry of the diapers. Its item\'s other entries fill the places list.',
		diaper_item_id: 'Used only when no entry id is given.',
		default_location: 'Preselected in "Take one from", by the place\'s name or path.',
		home_gnome_entry_id: 'Default: the only Home Gnome server.',
		huckleberry_device_id: 'Default: the device that owns the diaper sensor.',
		script: 'Called with kind, pee_amount, poo_amount, diaper_rash and notes instead of the Huckleberry actions.',
	};

	if ( ! customElements.get( CARD ) ) {
		customElements.define( CARD, HuckleberryDiaperCard );
	}
	if ( ! customElements.get( EDITOR ) ) {
		customElements.define( EDITOR, HuckleberryDiaperCardEditor );
	}
	window.customCards = window.customCards || [];
	if ( ! window.customCards.some( ( c ) => c.type === CARD ) ) {
		window.customCards.push( {
			type: CARD,
			name: 'Huckleberry diaper card',
			description: 'Log a diaper change in Huckleberry and take a diaper from a Home Gnome place.',
			preview: false,
			documentationURL: 'https://github.com/trevorbicewebdesign/huckleberry-dashboard',
		} );
	}

	// For tests (Node/jsdom): the pure logic, without touching the page.
	const logic = { KINDS, SIZES, sizeRowsFor, canLog, huckleberryCall, scriptCall, placesFrom, defaultPlace, errorText, relative };
	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = logic;
	}
	window.__huckleberryDiaperCardLogic = logic;
} )();
