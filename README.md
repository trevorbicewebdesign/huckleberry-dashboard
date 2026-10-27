# Huckleberry cards for Home Assistant

Two custom cards for the Huckleberry baby tracker as brought into Home Assistant by
[Woyken's Huckleberry integration](https://github.com/Woyken/huckleberry-homeassistant):

- **[Huckleberry diaper card](#huckleberry-diaper-card)** (`huckleberry-diaper-card.js`): log a diaper
  change in Huckleberry and take a diaper from a Home Gnome place, in one tap.
- **[Huckleberry growth card](#huckleberry-growth-card)** (`huckleberry-growth-card.js`): the child's
  weight, length and head circumference plotted against the WHO percentile curves.

Each card is one file with no build step and no framework. Install each the same way: copy the
file into `config/www/` and add it as its own JavaScript module resource (one resource per file).
Home Assistant 2025.3 or later.

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

One file, no build step, no framework. Home Assistant 2025.3 or later.

### Install

1. Copy `huckleberry-diaper-card.js` into your config folder as `config/www/huckleberry-diaper-card.js`
   (make `www` if it is new, and restart Home Assistant once so `/local/` is served).
2. **Settings › Dashboards › ⋮ › Resources › Add resource**: URL `/local/huckleberry-diaper-card.js`,
   type **JavaScript module**. (Resources need *Advanced mode* on your profile.)
3. Reload the browser (the companion app: pull down, or close and reopen).
4. On a dashboard, **Edit › Add card › Huckleberry diaper card**, or paste the YAML below into a
   manual card. The picker's form has every option; YAML is the same keys.

To update, copy the new file over the old one and add `?v=2` (any new number) to the resource URL
so phones fetch it again.

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

## Huckleberry growth card

The child's weight, length and head circumference from Huckleberry, plotted against the WHO Child
Growth Standards percentile curves (3rd, 15th, 50th, 85th and 97th, 0–24 months), with the current
percentile of each measure in a header strip. Tap a measure to switch the chart; tap a point for its
date, value and percentile. Made for a full-width section, phone first.

It needs Woyken's Huckleberry integration, for the child's `sensor.<child>_growth` (the latest
measurement), `calendar.<child>_events` (every past measurement is read from its "Growth
Measurement" events) and `sensor.<child>_profile` (the name, birth date and sex).

### Install

As for the diaper card, with `huckleberry-growth-card.js`:

1. Copy `huckleberry-growth-card.js` to `config/www/huckleberry-growth-card.js`.
2. **Settings › Dashboards › ⋮ › Resources › Add resource**: URL `/local/huckleberry-growth-card.js`,
   type **JavaScript module**. Each card file is its own resource.
3. Reload the browser, then **Edit › Add card › Huckleberry growth card**, or paste the YAML below.
   The card fills its section (`columns: full`); a one-column sections view or a panel view gives
   it the whole width.

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
