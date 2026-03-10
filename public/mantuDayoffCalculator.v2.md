# Mantu Day-off Calculator V2

A browser bookmarklet that calculates remaining day-offs for Mantu employees in Vietnam, based on data from the ARP timesheet page.

## How it works

The script is hosted on Netlify and loaded via a tiny bookmarklet. When clicked, it:

1. Redirects to the ARP holidays history page (if not already there)
2. Expands the table to show all rows (100 per page)
3. Scrapes validated day-off entries from the Quasar table
4. Calculates remaining day-offs per year and displays results in a modal

## Bookmarklet

Create a browser bookmark with this URL:

```
javascript:void(document.head.appendChild(Object.assign(document.createElement('script'),{src:'https://utilitiestools.netlify.app/mantuDayoffCalculator.v2.js?t='+Date.now()})))
```

The `?t=Date.now()` cache-busts so you always get the latest version.

## V1 vs V2

| | V1 | V2 |
|---|---|---|
| Data source | Old ARP page with full history | New ARP page (limited history) |
| Start year | Joining year | 2026 (configurable via `FIRST_CALCULATED_YEAR`) |
| Initial carryover | Calculated from year 1 | User-inputted remaining 2025 day-offs |
| Public holidays | Fetched from Netlify JSON | Inlined in the script |
| Delivery | Single bookmarklet (large) | Loader bookmarklet + hosted script |

## Day-off Policy Rules

- **Base allowance**: 14 days/year
- **Seniority bonus**: +0.5 days per year of service
- **Max carryover**: 5 days to next year
- **Reset date**: April 30 - carried-over days must be used before this date

## Calculation Logic

### 1. Total Allowed Day-offs (seniority-based, prorated)

The allowance is split at the joining anniversary within each year:

- **Before anniversary**: previous year's seniority rate
- **After anniversary**: current year's seniority rate

```
rate_before = (14 + (years_since_joining - 1) * 0.5) / 12
rate_after  = (14 + years_since_joining * 0.5) / 12

total_allowed = rate_before * months_before_anniversary
              + rate_after  * months_after_anniversary
```

**Example**: Joined March 28, 2022. Calculating for 2026:

- Years since joining: 4
- Before March 28 (seniority = 3): (14 + 1.5) / 12 * 2.871 months = 3.71 days
- After March 28 (seniority = 4): (14 + 2.0) / 12 * 9.129 months = 12.17 days
- **Total: 15.88 days**

### 2. Day-offs Taken

Sums validated entries from the ARP table for the year, handling:

- Entries entirely within the year (use `entry.days` directly)
- Entries spanning from previous year into this year (count only days in this year)
- Entries spanning from this year into next year (count only days in this year)
- Entries spanning the reset date April 30 (split into before/after reset)

### 3. Remaining Day-offs

```
remaining = total_allowed + min(carried_over, taken_before_reset) - total_taken
```

The `min(carried_over, taken_before_reset)` term means carried-over days only count if you actually used them before the reset date (April 30).

### 4. Carryover to Next Year

```
carryover = min(5, remaining)
```

### Year Chaining

V2 chains calculations from `FIRST_CALCULATED_YEAR` to `CURRENT_YEAR`:

```
2026: carryover = user-inputted remaining 2025 day-offs
2027: carryover = calculated from 2026 result
2028: carryover = calculated from 2027 result
...
```

## User Inputs (stored in localStorage)

| Key | Description | Example |
|---|---|---|
| `mantu-dayoff-calculator-joining-date` | Mantu joining date (YYYY-MM-DD) | `2022-03-28` |
| `mantu-dayoff-calculator-remaining-2025` | Day-offs carried over from 2025 (0-5, step 0.5) | `3.5` |

## Result Modal Output

For each year, the modal shows:

1. **Total allowed day-offs (seniority)** - prorated allowance based on seniority
2. **Carried-over day-offs from previous year** - capped at 5
3. **Total day-offs taken** - from validated ARP entries
4. **Day-offs taken before reset date** - used to determine how many carried-over days count
5. **Total day-offs (excluding carried-over)** - `taken - min(carried_over, taken_before_reset)`
6. **Remaining day-offs** (current year only) - `allowed - total_excluding_carried_over`

## Features

- Dark/light mode toggle (syncs with ARP page Quasar theme)
- Shadow DOM isolation (styles don't leak into/from the ARP page)
- Input validation with disabled confirm button
- Console logging of parsed entries for debugging

## Updating Public Holidays

When new year holidays are announced, add them to the `publicHolidays` constant in the script:

```javascript
const publicHolidays = {
  "2026": [ ... ],
  "2027": [ "2027-01-01", ... ]  // Add new year here
};
```

## Files

| File | Description |
|---|---|
| `mantuDayoffCalculator.v2.js` | Main script (hosted, loaded by bookmarklet) |
| `mantuDayoffCalculator.v2.bookmarklet.txt` | Bookmarklet URL for easy copy-paste |
| `mantuDayoffCalculator.v2.md` | This documentation |
