# Huckleberry dashboard cards for Home Assistant

Custom cards for the Huckleberry baby tracker as brought into Home Assistant by
[Woyken's Huckleberry integration](https://github.com/Woyken/huckleberry-homeassistant):

- **[Huckleberry diaper card](#huckleberry-diaper-card)**: log a diaper change in Huckleberry and
  take a diaper from a Home Gnome place, in one tap.
- **[Huckleberry feeding card](#huckleberry-feeding-card)**: start a bottle, then log in
  Huckleberry what the child actually had (Huckleberry cannot edit a logged bottle).
- **[Huckleberry sleep card](#huckleberry-sleep-card)**: the sleep timer with start, pause,
  resume and complete, a live "sleeping since" line, a start-time correction and a form for a
  past sleep.
- **[Huckleberry recent card](#huckleberry-recent-card)**: the last days' diapers, bottles,
  solids, sleeps and growth, newest first and by day, from Home Assistant's own history, with
  "Load older" reaching back through the Huckleberry calendar.
- **[Huckleberry growth card](#huckleberry-growth-card)**: the child's weight, length and head
  circumference plotted against the WHO percentile curves.

Every card is one plain JavaScript file in `dist/`, with no build step and no framework, a
form in the card picker, and the theme's colours. Home Assistant 2025.3 or later.

## Install

One resource loads every card: `dist/huckleberry-dashboard.js` imports the card files beside it.

### With HACS

1. **HACS › ⋮ › Custom repositories**: add `https://github.com/trevorbicewebdesign/huckleberry-dashboard`
   as a **Dashboard** repository, then download **Huckleberry dashboard**.
2. HACS registers the resource `/hacsfiles/huckleberry-dashboard/huckleberry-dashboard.js` itself
   (it downloads the whole `dist/` folder). If you had installed single card files by hand before,
   remove their `/local/…` resources under **Settings › Dashboards › ⋮ › Resources**, so each card
   is defined once.
3. Reload the browser (the companion app: pull down, or close and reopen). Updates come through
   HACS like any other.

### By hand

1. Copy the `dist/` folder into your config as `config/www/community/huckleberry-dashboard/`
   (so that `config/www/community/huckleberry-dashboard/huckleberry-dashboard.js` exists; make
   `www` if it is new and restart Home Assistant once so `/local/` is served).
2. **Settings › Dashboards › ⋮ › Resources › Add resource**: URL
   `/local/community/huckleberry-dashboard/huckleberry-dashboard.js`, type **JavaScript module**.
   (Resources need *Advanced mode* on your profile.)
3. Reload the browser. To update, copy the new `dist/` over the old one and add `?v=2` (any new
   number) to the resource URL so phones fetch the files again.

Then, on a dashboard, **Edit › Add card** and pick the card by name, or paste its YAML from the
sections below into a manual card. The picker's form has every option; YAML is the same keys.

The feeding card also needs a few helpers, made once from [`packages/huckleberry_feeding.yaml`](packages/huckleberry_feeding.yaml)
(see its section). The sleep card's start-time controls need the Huckleberry integration 0.5.6
or later.

### Try the checks

`node tests/check.js`, `tests/check-feeding.js`, `tests/check-sleep.js`, `tests/check-recent.js`
and `tests/check-growth.js` each check one card's logic in Node (nothing to install). Each card's
section says how to try it on a Home Assistant without Huckleberry.

## Huckleberry diaper card

A Home Assistant custom card: log a diaper change in Huckleberry and take a diaper from a Home
Gnome place, in one tap.

The card shows the child's name and last change, four kind buttons (Pee, Poo, Mixed, Dry), only
the size rows that kind needs, a note box, a Diaper rash checkbox, a "Take one from" dropdown of
the Home Gnome places holding diapers, and one Log button.

It needs:

- [Woyken's Huckleberry integration](https://github.com/Woyken/huckleberry-homeassistant), for the
  child's `sensor.<child>_diaper` entity and the `huckleberry.log_diaper_*` actions (or a script of
  your own that logs the change, see `script` below).
- The [Home Gnome integration](https://github.com/trevorbicewebdesign/home-gnome-ha), for the
  places that hold diapers (read through its API proxy as the signed-in user's linked person) and
  `home_gnome.use_one`. Whoever taps Log must be a **linked person** on the Home Gnome server, or
  the places list is empty and the diaper is not taken.

### Install

See [Install](#install) above: the one resource loads this card too. Then **Edit › Add card ›
Huckleberry diaper card**, or paste the YAML below.

### Config

```yaml
type: custom:huckleberry-diaper-card
diaper_entity: sensor.<child>_diaper   # the child's "last diaper" sensor (required)
diaper_entry_id: <inventory id>        # a Home Gnome inventory entry of the diapers (required, or diaper_item_id)
default_location: <place name>         # preselected in "Take one from", e.g. the changing station's shelf
```

`diaper_entry_id` is the id of any one inventory entry of the diapers (the number in the entry's
address in the Home Gnome app, `/edit/entry/<id>`). The places list is every entry of that entry's
item that has diapers in it, so a diaper bag shows up beside the shelf without being named.

All keys:

| Key | Default | What |
| --- | --- | --- |
| `diaper_entity` | required | The child's diaper sensor from Huckleberry, `sensor.<child>_diaper`. Its state is shown as the last change. |
| `child_name` | the sensor's friendly name without "Diaper" | The card's title. |
| `huckleberry_device_id` | the device that owns `diaper_entity` (from the entity registry) | The child's device, which the `huckleberry.log_diaper_*` actions take. |
| `home_gnome_entry_id` | the only Home Gnome config entry | Which Home Gnome server. Found with `config_entries/get` (admins) or from any `home_gnome` entity's registry record (everyone else); set it when there are two servers, or when a non-admin user with no Home Gnome sensors uses the card. |
| `diaper_entry_id` | — | A Home Gnome inventory entry (a row) of the diapers. `GET inventory/<id>` answers with every entry of its item, which fills the places list. One of this or `diaper_item_id` is required. |
| `diaper_item_id` | — | The known item instead, read with `GET items/<id>`. Used only when `diaper_entry_id` is not given. |
| `default_location` | — | The place preselected in "Take one from", by its name or any part of its path, case-insensitively. |
| `default_location_id` | — | The same by the location's id. Wins over `default_location`. With neither, `diaper_entry_id`'s own place, else the first. |
| `script` | — | A script to call instead of the Huckleberry actions, such as `script.log_a_diaper_change`. It gets `kind` (`pee`, `poo`, `both`, `dry`), `pee_amount` and `poo_amount` (`little`, `medium`, `big`, only when chosen), `diaper_rash` (`true`, only when ticked) and `notes` (only when typed). `huckleberry_device_id` is then not needed. |

#### Using your own script

With `script` set, the card calls that script with the fields above and nothing else. The script
needs matching fields, and should send each amount, `diaper_rash` and `notes` to Huckleberry only
when it was given (an empty amount is refused by Huckleberry). A script written before the Diaper
rash checkbox needs a `diaper_rash` field added:

```yaml
fields:
  kind:
    selector:
      select:
        options: [pee, poo, both, dry]
  pee_amount:
    selector:
      select:
        options: [little, medium, big]
  poo_amount:
    selector:
      select:
        options: [little, medium, big]
  diaper_rash:
    selector:
      boolean:
  notes:
    selector:
      text:
```

### What it does

- **Kind**: Pee, Poo, Mixed or Dry. Below it, only the size rows that kind needs: one Small /
  Medium / Large row for Pee or Poo, a labelled pee row and poo row for Mixed, none for Dry.
  Log stays off until every row shown has a size. Tapping a chosen kind or size again clears it.
- **Note**: free text, sent as Huckleberry's `notes` when typed, cleared after each log.
- **Diaper rash**: a checkbox under the note, shown for every kind. Sent as `diaper_rash: true`
  only when ticked, and cleared after each log.
- **Take one from**: every Home Gnome place holding the diaper item, with how many are there,
  the default preselected, and "Don't take one" last. Built live from the server when the card
  loads and after every log.
- **Log** (one button, never on a size tap): calls `huckleberry.log_diaper_pee` / `_poo` /
  `_both` / `_dry` on the child's device with `pee_amount` / `poo_amount` in Huckleberry's words
  (Small → `little`, Large → `big`), then `home_gnome.use_one` with the chosen entry (credited to
  the signed-in user's linked person), then clears the kind, sizes, note and rash box, refreshes
  the places, and shows **Logged** for a moment.
- **Errors** show inline under the button: Huckleberry refusing or missing ("Huckleberry did not
  log it: …"), the diaper not taken (the change is still logged; the message says so, with Home
  Gnome's reason: no such entry, not linked, server away), and above the places list when they
  could not be read (not linked, wrong entry id, no Home Gnome server).
- Phone width first: four kind buttons across, 48 px targets, the theme's `--primary-color`,
  `--card-background-color`, `--primary-text-color`, `--secondary-text-color` and `--divider-color`.

### Try it

- `node tests/check.js` checks the contingency and call-building logic without a browser (Node
  only, nothing to install).
- In a dev Home Assistant without Huckleberry: point `script` at a stub script that takes `kind`,
  `pee_amount`, `poo_amount`, `diaper_rash` and `notes` (for example one that writes a persistent
  notification), and set the sensor's state by hand (`POST /api/states/sensor.<child>_diaper` with
  a timestamp and `friendly_name`). Without `script`, the card reports "Huckleberry did not log it:
  Service huckleberry.log_diaper_pee not found" inline and takes no diaper, which is the refusal path.
- On the real Home Assistant, the first log is best made with "Don't take one" chosen and a
  `dry` check, to see Huckleberry take it before a diaper is counted off the shelf.

## Huckleberry feeding card

Bottles in two steps, because Huckleberry cannot edit a bottle once it is logged. **Start
bottle** notes how much was prepared, what is in it and a note; nothing goes to Huckleberry
yet. While the bottle is open the card shows it (started at, prepared amount, contents) with an
editable **Had** amount, and **Finish** logs it with `huckleberry.log_bottle` (amount = had,
the start time, the contents, the note). Starting a new bottle finishes an open one first with
its had amount (the prepared amount when none was entered). The open bottle lives in a few Home
Assistant helpers, so every phone sees the same bottle.

It needs Woyken's Huckleberry integration (the child's `sensor.<child>_bottle` and the
`huckleberry.log_bottle` action) and the helpers below.

### Helpers (once per household)

Copy [`packages/huckleberry_feeding.yaml`](packages/huckleberry_feeding.yaml) into your config
folder as `config/packages/huckleberry_feeding.yaml`, make sure `configuration.yaml` loads
packages:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

and restart Home Assistant. It defines `input_datetime.huckleberry_bottle_started`,
`input_number.huckleberry_bottle_prepared`, `input_number.huckleberry_bottle_had`,
`input_select.huckleberry_bottle_type` and `input_text.huckleberry_bottle_note` (no child name:
one open bottle at a time is enough for a household; for two children copy the file with another
prefix and set `helper_prefix`). Until they exist the card says which are missing and keeps the
Start button off.

### Config

```yaml
type: custom:huckleberry-feeding-card
bottle_entity: sensor.<child>_bottle   # the child's "last bottle" sensor (required)
```

All keys:

| Key | Default | What |
| --- | --- | --- |
| `bottle_entity` | required | The child's bottle sensor from Huckleberry, `sensor.<child>_bottle`. Its state and attributes (`time`, `amount`, `units`, `type`) are shown as the last bottle. |
| `child_name` | the sensor's friendly name without "Bottle" | The card's title. |
| `huckleberry_device_id` | the device that owns `bottle_entity` | The child's device, which `huckleberry.log_bottle` takes. |
| `helper_prefix` | `huckleberry` | The helpers' prefix: `input_number.<prefix>_bottle_prepared` and so on. |
| `units` | `oz` | `oz` or `ml`: the unit of every amount on the card and in the helpers, sent to Huckleberry as `units`. Give every feeding card the same. |
| `default_amount` | 4 oz / 120 ml | The prepared amount preselected. |
| `step` | 0.5 oz / 10 ml | What − and + add or take. |
| `bottle_types` | `[formula, breast_milk]` | The contents offered, from Huckleberry's `formula`, `breast_milk`, `tube_feeding`, `cow_milk`, `goat_milk`, `soy_milk`, `other`. |
| `default_type` | the first | The contents preselected. |

### What it does

- **Start bottle**: prepared amount (a box with − / + in `step`s), contents (one button each),
  note. Writes the helpers (`input_datetime.set_datetime` with the start, prepared and had both
  to the prepared amount, the type, the note). If a bottle is already open it is finished first
  (below), and the form sits under **Start another bottle…**.
- **Bottle in progress**: started at and how long ago, prepared amount and contents, the note.
  **Had** starts at the prepared amount; − / + or typing changes it and writes
  `input_number.<prefix>_bottle_had` half a second later, so another phone picking the baby up
  sees the same number.
- **Finish**: `huckleberry.log_bottle` with `device_id`, `amount` (had, or prepared when had was
  never changed from 0), `units`, `bottle_type`, `start_time` (the start, with the browser's UTC
  offset) and `notes` when typed. Then prepared and had go to 0 and the note is cleared, which is
  what "no bottle open" means. A Huckleberry refusal keeps the bottle open and shows the reason
  inline.
- **Last bottle**: from `sensor.<child>_bottle`, with its amount, contents and time.

### Try it

- `node tests/check-feeding.js` checks the helper reading, the writes, the log_bottle call and
  the amount stepping without a browser.
- In a dev Home Assistant without Huckleberry: load the package above, set
  `sensor.<child>_bottle` with `POST /api/states/…` (a timestamp state; attributes `time`,
  `amount`, `units`, `type`), and give the dev HA a `huckleberry.log_bottle` action (a stub
  custom integration that registers it and writes a persistent notification is enough).
  Without one, Finish reports "Huckleberry did not log the bottle: Service huckleberry.log_bottle
  not found" and keeps the bottle open.

## Huckleberry sleep card

The sleep timer from Huckleberry: **Start sleep**, then **Pause** / **Resume**, **Complete** and
**Cancel timer**, with a live "Sleeping since 1:05 PM (23 min)" line read from
`sensor.<child>_sleep`, the previous sleep in the header, a **Started at** time box that moves
the start of a running timer, and a **Log a past sleep** form (fell asleep, woke up, note) for a
nap nobody timed.

It needs Woyken's Huckleberry integration: `sensor.<child>_sleep` (states `active`, `paused`,
`none`; attributes `current_start`, `current_end`, `previous_start`, `previous_duration`) and the
`huckleberry.start_sleep` / `pause_sleep` / `resume_sleep` / `cancel_sleep` / `complete_sleep`
actions. **Started at** and **Log a past sleep** use the `start_time` field of `start_sleep` and
the `log_sleep` action, which came with integration **0.5.6**; on an older integration the card
hides them and says so.

### Config

```yaml
type: custom:huckleberry-sleep-card
sleep_entity: sensor.<child>_sleep   # the child's sleep sensor (required)
```

All keys:

| Key | Default | What |
| --- | --- | --- |
| `sleep_entity` | required | The child's sleep status sensor, `sensor.<child>_sleep`. |
| `child_name` | the sensor's friendly name without "Sleep" | The card's title. |
| `huckleberry_device_id` | the device that owns `sleep_entity` | The child's device, which the sleep actions take. |
| `integration_version` | read from the actions | The installed integration's version, such as `0.5.6`. By default the card looks at the action descriptions Home Assistant sends the browser (`start_sleep` having a `start_time` field and `log_sleep` existing); set this to force the time controls on (`0.5.6`) or off (`0.5.5`). |
| `log_form` | `true` | Whether **Log a past sleep** is shown (when the integration allows it). |

### What it does

- **Status**: `active` → "Sleeping since <time> (<elapsed>)", ticking every second; `paused` →
  "Paused at <time> · <elapsed> so far" (elapsed stops at `current_end`); `none` → "Awake".
- **Buttons** by state: Start sleep; Pause, Complete, Cancel timer; Resume, Complete, Cancel
  timer. Each calls its `huckleberry.*_sleep` action on the child's device and shows "Done" for a
  moment, or the refusal inline.
- **Started at** (running timer, 0.5.6+): a time box holding the timer's start. Changing it calls
  `huckleberry.start_sleep` with `start_time`, which the integration documents as moving the
  start of the running session (no cancel and restart, so nothing is lost if the call fails). A
  time later than now is read as yesterday. Start times in the future are refused before calling.
- **Log a past sleep** (0.5.6+): fell asleep and woke up (date and time), a note, and a button
  saying how long that is. Calls `huckleberry.log_sleep` with `start_time`, `end_time` and
  `notes`. The end must come after the start and not after now.
- **Previous sleep**: `previous_duration` (an ISO 8601 duration) and `previous_start` in the
  header.
- Times are sent with the browser's UTC offset (`2026-10-27T13:05:00-07:00`), which the
  integration reads as that instant.

### Try it

- `node tests/check-sleep.js` checks the sensor reading, the version detection and every call.
- In a dev Home Assistant without Huckleberry: set `sensor.<child>_sleep` by hand
  (`POST /api/states/…` with state `active` and `current_start`), and register stub
  `huckleberry.start_sleep` … `log_sleep` actions with a `services.yaml` that lists `start_time`
  on `start_sleep`, or set `integration_version: 0.5.6` on the card and `0.5.5` on a second one
  to see both faces.

## Huckleberry recent card

A newest-first list of the child's events, grouped by day: diapers (kind, sizes when known),
bottles (amount and contents), solids (foods), sleeps (duration, and the one running now), and
growth measurements. The last `days` days come from Home Assistant's **recorder**, the history of
the child's own sensors, so the list is there at once and never asks Huckleberry. **Load older**
at the bottom reads the month before what is shown from `calendar.<child>_events` (which does
ask Huckleberry) and appends it; tap again for the month before that.

It needs Woyken's Huckleberry integration's sensors (`sensor.<child>_diaper`, `_bottle`,
`_solids`, `_sleep`, `_growth`; any that exist) and, for older events, `calendar.<child>_events`.
The recorder must keep those sensors (it does unless you excluded them) for as many days as
`days`, which is the recorder's default of 10.

### Config

```yaml
type: custom:huckleberry-recent-card
child: <slug>   # the middle of the entity ids: "mia" for sensor.mia_diaper
days: 7
```

All keys:

| Key | Default | What |
| --- | --- | --- |
| `child` | — | The slug of the child's entities: `sensor.<child>_diaper` and the rest are derived from it. |
| `diaper_entity`, `bottle_entity`, `solids_entity`, `sleep_entity`, `growth_entity` | from `child` | Each sensor by name instead; `none` leaves one out. At least one sensor, by `child` or by name, is required. |
| `calendar_entity` | `calendar.<child>_events` | The Huckleberry calendar for **Load older**; `none` hides the button. |
| `days` | `7` | How many days back the recorder is asked for. |
| `title` | the child's name from a sensor | The card's title. |

### What it does

- **History**: one websocket call, `history/history_during_period`, for the sensors over the last
  `days` days (the REST `history/period` endpoint when the websocket command is refused). The
  diaper, bottle, solids and growth sensors hold the last event's time as their state, so each
  distinct state in the history is one event, with the attributes of that moment (`type`,
  `amount` and `units`, `foods`, the measurements); each distinct `previous_start` of the sleep
  sensor is a finished sleep with its `previous_duration`. A running or paused sleep is shown at
  the top from the live sensor. Read again whenever one of the sensors changes.
- **Load older**: `GET calendars/<entity>?start&end` for a 31-day window ending where the list
  ends, parsed from the integration's event summaries and descriptions ("💧 Diaper (Pee)" with
  "Pee amount: medium", "🍼 Bottle (4 oz)" with "Type: formula", "🥄 Solids (…)", "💤 Sleep (1h 20m)",
  "📏 Growth Measurement", also nursing "🍼 Feed", "🚽 Potty", and anything else by its summary).
  Calendar rows know diaper sizes and notes, which the sensors do not. Events are merged with
  the history by kind and minute, so the overlap at the boundary shows once.
- **Rows**: the time, an icon, and one line: `Diaper Mixed · pee medium, poo large`,
  `Bottle 4 oz formula`, `Sleep 1 h 20 min`, `Growth 7.2 kg · 65.5 cm · 42 cm`, with the note in
  italics when there is one. Days are "Today", "Yesterday", then "Mon, Oct 20".

### Try it

- `node tests/check-recent.js` checks both parsers, the merging and the day grouping.
- In a dev Home Assistant without Huckleberry: set the sensors with `POST /api/states/…` a few
  times with different timestamp states (each becomes a history row), and give the dev HA a
  Local calendar named `<child> events` with a few events in the integration's wording for
  **Load older**.

## Huckleberry growth card

The child's weight, length and head circumference from Huckleberry, plotted against the WHO Child
Growth Standards percentile curves (3rd, 15th, 50th, 85th and 97th, 0–24 months), with the current
percentile of each measure in a header strip. Tap a measure to switch the chart; tap a point for its
date, value and percentile. Made for a full-width section, phone first.

It needs Woyken's Huckleberry integration, for the child's `sensor.<child>_growth` (the latest
measurement), `calendar.<child>_events` (every past measurement is read from its "Growth
Measurement" events) and `sensor.<child>_profile` (the name, birth date and sex).

### Install

See [Install](#install) above. Then **Edit › Add card › Huckleberry growth card**, or paste the
YAML below. The card fills its section (`columns: full`); a one-column sections view or a panel
view gives it the whole width.

### Config

```yaml
type: custom:huckleberry-growth-card
growth_entity: sensor.<child>_growth   # the child's growth sensor (required)
```

That is all it needs when the profile sensor carries the birth date. All keys:

| Key | Default | What |
| --- | --- | --- |
| `growth_entity` | required | The child's growth sensor, `sensor.<child>_growth`. Its latest measurement is added when the calendar does not have it yet. |
| `calendar_entity` | `calendar.<child>_events` | The child's Huckleberry calendar. Its "Growth Measurement" events from the birth date to today are the history. `none` turns the calendar off (with `events`, see below). |
| `profile_entity` | `sensor.<child>_profile` | The child's profile sensor: its state is the name, its `birthday` and `gender` attributes the birth date and sex. |
| `child_name` | the profile's name | The card's title. |
| `birth_date` | the profile's `birthday` | `YYYY-MM-DD`. Needed when the profile has no birthday: age is the x-axis. |
| `sex` | the profile's `gender`, else `girl` | `girl` or `boy`: which WHO tables (they differ by sex). |
| `units` | the unit each measurement was logged in | `metric` (kg, cm) or `imperial` (lb oz, in) for every measure. |
| `measure` | `weight` | The tab shown first: `weight`, `length` or `head`. |
| `months` | the child's age rounded up, at most 24 | Months on the x-axis (1–24). |
| `events` | — | **For testing only**: measurements instead of the calendar, as `[{ date: 2026-04-20, weight: 3.2 kg, height: 49 cm, head: 34 cm }, …]` (text with a unit, or numbers in kg/cm), or in Home Assistant's calendar event shape (`start`, `summary`, `description`). |

### What it does

- **Measurements**: every "📏 Growth Measurement" event of the calendar between the birth date and
  today, read with Home Assistant's calendar API and parsed from the description lines the
  integration writes (`Weight: 7.3 kg`, `Height: 65 cm`, `Head: 42 cm`; imperial `lb`, `in`, and
  `ft`, which is the integration's label for Huckleberry's `ft.in` setting whose values are
  inches). The growth sensor's latest reading is added when it is newer than the last event. Read
  again when the sensor changes and every 30 minutes.
- **Cache**: each read of the calendar goes to Huckleberry's servers and is slow, so the parsed
  measurements are kept in the browser's `localStorage` under `huckleberry-growth:<calendar entity>`.
  On load the cached points show at once and the calendar is asked only from the day before the
  last cached measurement to today; what comes back is merged in (one point per minute, the new
  copy winning). A measurement edited or deleted in the Huckleberry app before that date stays as
  cached until you tap **↻** in the card's header, which clears the cache and reads everything
  from the birth date again. The cache is per browser (each phone keeps its own) and the card
  works without it (a private window, or storage full) by reading the whole calendar as before.
- **Percentiles**: the WHO LMS method, z = ((x/M)^L − 1) / (L·S), with the WHO Child Growth
  Standards tables (weight-for-age, length-for-age and head-circumference-for-age, girls and boys,
  by month from 0 to 24) embedded in the file. Age in months is days / 30.4375, and L, M and S are
  interpolated between months. Measurements past 24 months are kept but get no percentile.
- **Chart**: inline SVG, no library, redrawn to the card's width. The 3rd–97th and 15th–85th bands
  are tinted, the 50th is the solid grey line, the child's points are joined in the theme's
  primary color, and a dotted line marks today's age. Axes are months and the display unit.
  Tapping a point puts its date, value and percentile under the chart; the latest is shown
  otherwise.
- **Units**: everything is converted to kg and cm for the math and shown in the unit the latest
  measurement of that measure was logged in (pounds as `16 lb 2 oz`), or in `units`.
- **Theme**: `--primary-color`, `--card-background-color`, `--primary-text-color`,
  `--secondary-text-color` and `--divider-color`.
- **Messages** under the chart when the growth sensor or calendar is missing, the calendar could
  not be read, or no birth date is known (set `birth_date`).

### Try it

- `node tests/check-growth.js` checks the event parser, the unit conversion and the LMS math against
  known WHO values (a 50th-percentile girl at 6 months weighs 7.3 kg and measures 65.7 cm) without
  a browser.
- In a dev Home Assistant without Huckleberry: set `sensor.<child>_growth` (state: a timestamp;
  attributes `weight`, `weight_unit`, `height`, `height_unit`, `head_circumference`, `head_unit`)
  and `sensor.<child>_profile` (state: the name; attributes `birthday`, `gender` as `F`/`M`) with
  `POST /api/states/…`, and either add a **Local calendar** named `<child> events` and create
  events on it with `calendar.create_event` (summary `📏 Growth Measurement`, description
  `Growth measurement` / `Weight: 7.3 kg` / `Height: 65 cm` / `Head: 42 cm`), or give the card an
  `events` list and `calendar_entity: none`.
