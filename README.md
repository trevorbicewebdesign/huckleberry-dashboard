# Huckleberry diaper card

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

## Install

1. Copy `huckleberry-diaper-card.js` into your config folder as `config/www/huckleberry-diaper-card.js`
   (make `www` if it is new, and restart Home Assistant once so `/local/` is served).
2. **Settings › Dashboards › ⋮ › Resources › Add resource**: URL `/local/huckleberry-diaper-card.js`,
   type **JavaScript module**. (Resources need *Advanced mode* on your profile.)
3. Reload the browser (the companion app: pull down, or close and reopen).
4. On a dashboard, **Edit › Add card › Huckleberry diaper card**, or paste the YAML below into a
   manual card. The picker's form has every option; YAML is the same keys.

To update, copy the new file over the old one and add `?v=2` (any new number) to the resource URL
so phones fetch it again.

## Config

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

### Using your own script

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

## What it does

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

## Try it

- `node tests/check.js` checks the contingency and call-building logic without a browser (Node
  only, nothing to install).
- In a dev Home Assistant without Huckleberry: point `script` at a stub script that takes `kind`,
  `pee_amount`, `poo_amount`, `diaper_rash` and `notes` (for example one that writes a persistent
  notification), and set the sensor's state by hand (`POST /api/states/sensor.<child>_diaper` with
  a timestamp and `friendly_name`). Without `script`, the card reports "Huckleberry did not log it:
  Service huckleberry.log_diaper_pee not found" inline and takes no diaper, which is the refusal path.
- On the real Home Assistant, the first log is best made with "Don't take one" chosen and a
  `dry` check, to see Huckleberry take it before a diaper is counted off the shelf.
