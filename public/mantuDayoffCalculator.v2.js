/**
 * Mantu Day-off Calculator V2
 *
 * A bookmarklet-loaded script that calculates remaining day-offs for Mantu employees
 * based on data scraped from the ARP timesheet page (Quasar-based UI).
 *
 * Key differences from V1:
 * - V1 had access to full history and calculated year-by-year from the joining year.
 * - V2 works with the new ARP page which lacks full history, so it starts from
 *   FIRST_CALCULATED_YEAR (2026) and uses a user-inputted "remaining 2025 day-offs"
 *   as the initial carried-over value.
 *
 * Day-off policy rules:
 * - Base allowance: 14 days/year
 * - Seniority bonus: +0.5 days per year of service (applied at joining anniversary)
 * - Carryover: up to 5 unused days carry over to next year
 * - Reset date: April 30 - carried-over days must be used before this date
 * - Carried-over days used after the reset date are forfeited
 *
 * Flow:
 * 1. If not on the holidays history page -> redirect there
 * 2. If table limit != 100 -> select max rows and wait for table to render
 * 3. If joining date or remaining 2025 day-offs not set -> show input modal
 * 4. Otherwise -> show result modal with per-year breakdown
 */
!(async function () {
  const VERSION = "v2.0.0";

  /* --- Configuration --- */

  const HOLIDAYS_PAGE_BASE = "https://timesheet.arp.mantu.com/my-history";
  const HOLIDAYS_PAGE_URL =
    "https://timesheet.arp.mantu.com/my-history?startDate=2021-01-01&absenceCategoryId=4&absenceCategoryParentId=1&orderBy=startDate&descending=true&page=1&limit=7&tab=pendingHolidays";
  const CALCULATOR_ELEMENT_ID = "mantuDayoffCalculator";

  /* localStorage keys for persisting user inputs */
  const JOINING_DATE_STORAGE_KEY = "mantu-dayoff-calculator-joining-date";
  const REMAINING_2025_DAYOFF_STORAGE_KEY = "mantu-dayoff-calculator-remaining-2025";

  /* Day-off policy constants */
  const BASE_DAYOFF_ALLOWANCE = 14;   /* Base annual day-off allowance */
  const SENIORITY_INCREMENT = 0.5;        /* Additional day-off days per year of seniority */
  const MAX_CARRYOVER_DAYS = 5;       /* Max days that can carry over to next year */
  const CARRYOVER_RESET_DAY = 30;               /* Day of the carryover reset date */
  const CARRYOVER_RESET_MONTH = 4;              /* Month of the carryover reset date (April) */

  const HALF_DAY = 0.5;                /* Half-day deduction for AM/PM entries */
  const MONTHS_PER_YEAR = 12;
  const DAYOFF_INPUT_STEP = 0.5;      /* Input step for remaining day-offs (0, 0.5, 1, ...) */
  const TABLE_RENDER_DELAY_MS = 1000; /* Wait time for ARP table to render after changing rows */
  const ONE_DAY_MS = 864e5;           /* Milliseconds in one day */
  const MAX_ROWS_PER_PAGE = "100";    /* Max rows to display in the ARP table */
  const DEBUG_MODE = false;
  const CURRENT_YEAR = new Date().getFullYear();
  const FIRST_CALCULATED_YEAR = 2026; /* V2 starts calculating from this year */

  /* Month abbreviation mapping for parsing ARP date format (e.g. "Apr 28th, 2026") */
  const MONTH_ABBR = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  };

  /* Vietnam public holidays - inlined to avoid network dependency.
   * Only years >= FIRST_CALCULATED_YEAR are needed.
   * Update this when new year holidays are announced. */
  const publicHolidays = {
    "2026": [
      "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18",
      "2026-02-19", "2026-02-20", "2026-04-27", "2026-04-30",
      "2026-05-01", "2026-09-01", "2026-09-02", "2026-11-24"
    ]
  };
  let publicHolidaySets = {}; /* Cached Set objects keyed by year */

  /* --- Utilities --- */

  /** Logs to console only when DEBUG_MODE is enabled */
  function debugLog(message) {
    if (DEBUG_MODE) console.error(message);
  }

  /** Returns the number of days in a given month (1-indexed) and year */
  function getDaysInMonth(month, year) {
    return new Date(year, month, 0).getDate();
  }

  /** Returns a Set of timestamps for public holidays in the given year (lazy-cached) */
  function getPublicHolidaySet(year) {
    if (!publicHolidaySets[year] && publicHolidays[year]) {
      publicHolidaySets[year] = new Set(
        publicHolidays[year].map((dateStr) => {
          const [y, m, d] = dateStr.split("-").map(Number);
          return new Date(y, m - 1, d).getTime();
        })
      );
    }
    return publicHolidaySets[year] || new Set();
  }

  /**
   * Parses a date string like "Apr 28th, 2026" into { day, month, year }
   */
  function parseDateText(text) {
    const cleaned = text.trim();
    const parts = cleaned.match(/^(\w{3})\s+(\d+)\w*,\s*(\d{4})$/);
    if (!parts) return null;
    return {
      month: MONTH_ABBR[parts[1]],
      day: parseInt(parts[2], 10),
      year: parseInt(parts[3], 10),
    };
  }

  /* --- Data access (localStorage + DOM scraping) --- */

  /** Retrieves the joining date from localStorage. Returns { day, month, year, ... } or null */
  function getJoiningDate() {
    const stored = localStorage.getItem(JOINING_DATE_STORAGE_KEY);
    if (!stored) return null;

    const parts = stored.split("-");
    return {
      day: parseInt(parts[2], 10),
      dayLabel: parts[2],
      month: parseInt(parts[1], 10),
      monthLabel: parts[1],
      year: parseInt(parts[0], 10),
      yearLabel: parts[0],
    };
  }

  /** Retrieves the user-inputted remaining 2025 day-offs from localStorage. Returns float or null */
  function getRemaining2025Dayoff() {
    const stored = localStorage.getItem(REMAINING_2025_DAYOFF_STORAGE_KEY);
    if (stored === null) return null;
    return parseFloat(stored);
  }

  /**
   * Scrapes the ARP Quasar table rows and extracts day-off entries.
   * Each row contains: status, start date + AM/PM, end date + AM/PM, total days.
   * Returns an array of entry objects.
   */
  function parseDayoffTableRows() {
    const rows = document.querySelectorAll("table.q-table tbody tr.q-tr");
    return Array.from(rows).map((row) => {
      const cells = row.querySelectorAll("td");

      /* Status */
      const statusEl = cells[0].querySelector(".text-weight-bold");
      const status = statusEl ? statusEl.textContent.trim() : "";

      /* Period cell */
      const periodCell = cells[1];
      const dateDivs = periodCell.querySelectorAll(".col-md-5");
      const daysEl = periodCell.querySelector(".text-weight-medium");
      const days =
        parseFloat(daysEl.textContent.trim().replace(/[^0-9.-]+/g, "")) || 0;

      /* Start date + AM/PM */
      const startDiv = dateDivs[0];
      const startSpans = startDiv.querySelectorAll("span");
      const startDateText = startSpans[0].textContent.trim();
      const startDate = parseDateText(startDateText);
      const startAMPMSpan = startDiv.querySelector("span + span");
      const startAMPM = startAMPMSpan
        ? startAMPMSpan.textContent.replace("~", "").trim()
        : "AM";

      /* End date + AM/PM (if range; otherwise same as start) */
      let endDate, endAMPM;
      if (dateDivs.length > 1) {
        const endDiv = dateDivs[dateDivs.length - 1];
        const endDateText = endDiv.childNodes[0].textContent.trim();
        endDate = parseDateText(endDateText);
        const endAMPMSpan = endDiv.querySelector("span");
        endAMPM = endAMPMSpan
          ? endAMPMSpan.textContent.replace("~", "").trim()
          : "PM";
      } else {
        endDate = { ...startDate };
        endAMPM = startAMPMSpan ? startAMPM : "PM";
      }

      return {
        status,
        startDay: startDate.day,
        startMonth: startDate.month,
        startYear: startDate.year,
        startAMPM,
        endDay: endDate.day,
        endMonth: endDate.month,
        endYear: endDate.year,
        endAMPM,
        days,
      };
    });
  }

  /* --- Core calculation (ported from v1) --- */

  /**
   * Counts working days in a date range, split at a given point.
   * Used to split day-off entries across year boundaries or the reset date.
   *
   * @param {Array} start       - [day, month, year] of the range start
   * @param {string} startAMPM  - "AM" or "PM" (PM means half-day start, subtract 0.5)
   * @param {Array} end         - [day, month, year] of the range end
   * @param {string} endAMPM    - "AM" or "PM" (AM means half-day end, subtract 0.5)
   * @param {Array} split       - [day, month, year] the split point
   * @param {boolean} countAllDays - If true, count all calendar days (not just working days)
   * @returns {{ daysUntilPoint: number, daysAfterPoint: number }}
   */
  function calculateDaysBetween(
    [startDay, startMonth, startYear],
    startAMPM,
    [endDay, endMonth, endYear],
    endAMPM,
    [splitDay, splitMonth, splitYear],
    countAllDays = false
  ) {
    const startDate = new Date(startYear, startMonth - 1, startDay);
    const endDate = new Date(endYear, endMonth - 1, endDay);
    const splitDate = new Date(splitYear, splitMonth - 1, splitDay);

    if (splitDate < startDate || splitDate > endDate) {
      return { daysUntilPoint: 0, daysAfterPoint: 0 };
    }

    const holidaySet = getPublicHolidaySet(splitYear);

    const countDays = (fromDate, toDate) => {
      let count = 0;
      let current = new Date(fromDate);
      while (current.getTime() <= toDate.getTime()) {
        if (countAllDays) {
          count++;
        } else {
          const dayOfWeek = current.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const isHoliday = holidaySet.has(current.getTime());
          if (!isWeekend && !isHoliday) {
            count++;
          }
        }
        current.setDate(current.getDate() + 1);
      }
      return count;
    };

    const dayAfterSplit = new Date(splitDate.getTime() + ONE_DAY_MS);

    return {
      daysUntilPoint:
        countDays(startDate, splitDate) + (startAMPM === "PM" ? -HALF_DAY : 0),
      daysAfterPoint:
        countDays(dayAfterSplit, endDate) + (endAMPM === "AM" ? -HALF_DAY : 0),
    };
  }

  /** Returns true if the entry is entirely within the given year and ends on or before the reset month */
  function isEntirelyBeforeResetDate(entry, year) {
    return (
      entry.startYear === entry.endYear &&
      entry.endYear === year &&
      entry.endMonth <= CARRYOVER_RESET_MONTH
    );
  }

  /**
   * Main calculation for a single year.
   *
   * Computes:
   * 1. Total allowed day-offs (prorated by seniority, split at joining anniversary)
   *    - Before anniversary: previous year's seniority rate
   *    - After anniversary: current year's seniority rate
   *    Formula: (BASE + prevSeniority * INCREMENT) / 12 * monthsBefore
   *           + (BASE + currSeniority * INCREMENT) / 12 * monthsAfter
   *
   * 2. Total day-offs taken (from validated entries in the ARP table)
   *    Handles entries that: span year boundaries, span the reset date, or are within the year
   *
   * 3. Carryover calculation:
   *    remaining = allowed + min(carriedOver, takenBeforeReset) - totalTaken
   *    toCarryOver = min(MAX_CARRYOVER_DAYS, remaining)
   *
   * @param {number} year - The year to calculate
   * @param {number} carriedOverDays - Days carried over from the previous year
   * @returns {Object} Calculation results for the year
   */
  function calculateYearDayoffs(year, carriedOverDays) {
    debugLog(`Year: ${year}`);

    const allEntries = parseDayoffTableRows();
    const joiningDate = getJoiningDate();
    const { day: joiningDay, month: joiningMonth, year: joiningYear } = joiningDate;
    const yearsSinceJoining = year - joiningYear;
    const previousYearsSinceJoining = Math.max(0, yearsSinceJoining - 1);

    /* Calculate proportional allowance split at the joining anniversary */
    let fullMonthsBeforeAnniversary = 0;
    let fullMonthsAfterAnniversary = MONTHS_PER_YEAR - joiningMonth;
    let daysBeforeAnniversaryInMonth = 0;
    let daysAfterAnniversaryInMonth = 0;
    const anniversaryMonthLength = getDaysInMonth(joiningMonth, year);

    if (year !== joiningYear) {
      fullMonthsBeforeAnniversary = joiningMonth - 1;
      const { daysUntilPoint, daysAfterPoint } = calculateDaysBetween(
        [1, joiningMonth, year],
        "AM",
        [anniversaryMonthLength, joiningMonth, year],
        "PM",
        [joiningDay - 1, joiningMonth, year],
        true
      );
      daysBeforeAnniversaryInMonth = daysUntilPoint;
      daysAfterAnniversaryInMonth = daysAfterPoint;
    } else {
      const { daysAfterPoint } = calculateDaysBetween(
        [1, joiningMonth, year],
        "AM",
        [anniversaryMonthLength, joiningMonth, year],
        "AM",
        [joiningDay - 1, joiningMonth, year],
        true
      );
      daysAfterAnniversaryInMonth = daysAfterPoint;
    }

    const totalAllowedDayoffs =
      ((BASE_DAYOFF_ALLOWANCE + previousYearsSinceJoining * SENIORITY_INCREMENT) / MONTHS_PER_YEAR) *
        (fullMonthsBeforeAnniversary + daysBeforeAnniversaryInMonth / anniversaryMonthLength) +
      ((BASE_DAYOFF_ALLOWANCE + yearsSinceJoining * SENIORITY_INCREMENT) / MONTHS_PER_YEAR) *
        (daysAfterAnniversaryInMonth / anniversaryMonthLength + fullMonthsAfterAnniversary);

    debugLog(`totalAllowedDayoff: ${totalAllowedDayoffs}`);

    /* Tally validated dayoffs for this year */
    let totalDayoffsTaken = 0;
    let dayoffsTakenBeforeReset = 0;

    console.log(`[${year}] All parsed entries:`, allEntries);

    const validatedEntries = allEntries.filter((entry) => {
      if (entry.status !== "Validated") return false;
      const isSameYear = entry.startYear === entry.endYear && entry.endYear === year;
      const startsBeforeYear = entry.startYear < year && entry.endYear === year;
      const endsAfterYear = entry.startYear === year && entry.endYear > year;
      return isSameYear || startsBeforeYear || endsAfterYear;
    });

    console.log(`[${year}] Validated entries used for calculation:`, validatedEntries);

    for (const entry of validatedEntries) {
      const entryStart = [entry.startDay, entry.startMonth, entry.startYear];
      const entryEnd = [entry.endDay, entry.endMonth, entry.endYear];

      /* Entirely within the same year */
      if (entry.startYear === entry.endYear && entry.endYear === year) {
        totalDayoffsTaken += entry.days;
      }

      /* Spans from previous year into this year */
      if (entry.startYear < year && entry.endYear === year) {
        const { daysAfterPoint } = calculateDaysBetween(
          entryStart, entry.startAMPM,
          entryEnd, entry.endAMPM,
          [31, 12, year - 1]
        );
        totalDayoffsTaken += daysAfterPoint;
        dayoffsTakenBeforeReset += daysAfterPoint;
      }

      /* Spans from this year into next year */
      if (entry.startYear === year && entry.endYear > year) {
        const { daysUntilPoint } = calculateDaysBetween(
          entryStart, entry.startAMPM,
          entryEnd, entry.endAMPM,
          [31, 12, year]
        );
        totalDayoffsTaken += daysUntilPoint;
      }

      /* Entirely before the reset date */
      if (isEntirelyBeforeResetDate(entry, year)) {
        dayoffsTakenBeforeReset += entry.days;
      }

      /* Spans across the reset date (April -> May) */
      if (entry.startMonth <= CARRYOVER_RESET_MONTH && entry.endMonth > CARRYOVER_RESET_MONTH) {
        const { daysUntilPoint, daysAfterPoint } = calculateDaysBetween(
          entryStart, entry.startAMPM,
          entryEnd, entry.endAMPM,
          [CARRYOVER_RESET_DAY, CARRYOVER_RESET_MONTH, year]
        );
        dayoffsTakenBeforeReset += daysUntilPoint;
        totalDayoffsTaken += daysAfterPoint;
      }
    }

    debugLog(`total dayoff: ${totalDayoffsTaken}`);
    debugLog(`totalDayoffBeforeResetDay: ${dayoffsTakenBeforeReset}`);

    /* Carryover calculation */
    const remainingDayoffs =
      totalAllowedDayoffs +
      Math.min(carriedOverDays, dayoffsTakenBeforeReset) -
      totalDayoffsTaken;
    let dayoffsToCarryOver = Math.min(MAX_CARRYOVER_DAYS, remainingDayoffs);

    debugLog(`left dayoff: ${dayoffsToCarryOver}`);
    debugLog("=====================");

    return {
      year,
      totalAllowedDayoffs,
      carriedOverDays,
      totalDayoffsTaken,
      dayoffsTakenBeforeReset,
      dayoffsToCarryOver,
      remainingDayoffs:
        totalAllowedDayoffs -
        totalDayoffsTaken +
        Math.min(carriedOverDays, dayoffsTakenBeforeReset),
    };
  }

  /* --- Rendering --- */

  /**
   * Renders the per-year day-off breakdown into the result modal.
   * Loops from FIRST_CALCULATED_YEAR to CURRENT_YEAR, chaining carryover
   * from each year to the next. The first year uses the user-inputted
   * remaining 2025 day-offs as its carried-over value.
   * Years are displayed in reverse order (most recent first).
   */
  function renderDayoffInfo(shadowRoot) {
    const joiningDate = getJoiningDate();
    const remaining2025 = getRemaining2025Dayoff();
    const htmlParts = [];

    /* v2: Start from FIRST_CALCULATED_YEAR, seed with user-inputted 2025 remaining */
    let carriedOverDays = remaining2025;

    for (let year = FIRST_CALCULATED_YEAR; year <= CURRENT_YEAR; year++) {
      const result = calculateYearDayoffs(year, carriedOverDays);
      carriedOverDays = result.dayoffsToCarryOver;

      let yearHtml = `
        <li><b>${year}</b></li>
        <ol>
          <li>Total allowed dayoffs (seniority): <b>${result.totalAllowedDayoffs.toFixed(2)}</b> days</li>
          <li>Carried-over dayoffs from ${year - 1}: <b>${result.carriedOverDays.toFixed(2)}</b> days</li>
          <li>Total dayoffs taken: <b>${result.totalDayoffsTaken.toFixed(2)}</b> days</li>
          <li>Dayoffs taken before ${CARRYOVER_RESET_DAY}/${CARRYOVER_RESET_MONTH}/${year}: <b>${result.dayoffsTakenBeforeReset.toFixed(2)}</b> days</li>
          <li>Total dayoffs (excluding carried-over days) <sup><i>(3 - min(2,4))</i></sup>: <b>${(result.totalDayoffsTaken - Math.min(result.carriedOverDays, result.dayoffsTakenBeforeReset)).toFixed(2)}</b> days</li>`;

      if (year === CURRENT_YEAR) {
        yearHtml += `
          <li>Remaining dayoffs <sup><i>(1 - 5)</i></sup>: <b>${result.remainingDayoffs.toFixed(2)}</b> days</li>`;
      }

      yearHtml += `
        </ol>`;

      /* TODO: v1 detailed breakdown per year (commented for now)
      htmlParts.push(`
        <li>${year}</li>
        <ol>
          ... full v1 breakdown ...
        </ol>
      `);
      */

      htmlParts.push(yearHtml);
    }

    shadowRoot.querySelector("#dayoffCalcInfo").innerHTML =
      `<ul>${htmlParts.reverse().join("")}</ul>`;
  }

  /* --- Theme --- */

  const SUN_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  const MOON_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

  /** Toggles Quasar dark/light mode via localStorage and reloads the page to apply */
  function toggleTheme() {
    const dark = document.body.classList.contains("body--dark");
    localStorage.setItem("darkMode", dark ? "__q_bool|0" : "__q_bool|1");
    window.location.reload();
  }

  /* --- Modal --- */

  /**
   * Shows the input modal for collecting user data (joining date + remaining 2025 day-offs).
   * - Confirm button is disabled until both fields are valid
   * - Validates on every input change and also on confirm click (guard against DevTools bypass)
   * - Saves values to localStorage on confirm, then calls onConfirm callback
   */
  function showInputModal(onConfirm) {
    document.getElementById(CALCULATOR_ELEMENT_ID)?.remove();

    const containerDiv = document.createElement("div");
    containerDiv.id = CALCULATOR_ELEMENT_ID;
    document.body.appendChild(containerDiv);

    const shadowRoot = containerDiv.attachShadow({ mode: "open" });
    const existingJoiningDate = localStorage.getItem(JOINING_DATE_STORAGE_KEY) || "";
    const existingRemaining = localStorage.getItem(REMAINING_2025_DAYOFF_STORAGE_KEY) || "";
    const dark = document.body.classList.contains("body--dark");

    shadowRoot.innerHTML = `
      <style>
        .modal-overlay {
          position: fixed;
          top: 0; left: 0;
          width: 100%; height: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          backdrop-filter: blur(1px);
          background-color: rgba(0, 0, 0, 0.3);
          z-index: 9999;
        }
        .modal-content {
          background: ${dark ? "#1d1d1d" : "white"};
          color: ${dark ? "#e0e0e0" : "inherit"};
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
          min-width: 350px;
        }
        .modal-content .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: bold;
          margin-bottom: 10px;
        }
        .theme-toggle {
          background: none;
          border: 1px solid ${dark ? "#555" : "#ccc"};
          border-radius: 4px;
          padding: 4px 6px;
          cursor: pointer;
          color: ${dark ? "#e0e0e0" : "#333"};
          display: flex;
          align-items: center;
        }
        .modal-content label {
          display: block;
          margin-bottom: 5px;
          margin-top: 10px;
        }
        .modal-content input {
          padding: 8px;
          border: 1px solid ${dark ? "#555" : "#ccc"};
          border-radius: 4px;
          width: 100%;
          box-sizing: border-box;
          background: ${dark ? "#2c2c2c" : "white"};
          color: ${dark ? "#e0e0e0" : "inherit"};
        }
        .modal-content .error {
          color: red;
          font-size: 12px;
          margin-top: 4px;
          display: none;
        }
        .footer {
          margin-top: 15px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        .btn {
          color: white;
          border: none;
          padding: 10px 15px;
          border-radius: 4px;
          cursor: pointer;
        }
        .secondaryBtn { background: #9E9E9E; }
        .primaryBtn { background: #6d2077; }
        .primaryBtn:disabled { background: #b0b0b0; cursor: not-allowed; }
        .version {
          margin-top: 20px;
          text-align: right;
          font-size: smaller;
          font-style: italic;
        }
      </style>
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="header">
            <span>Mantu Day-off Calculator V2</span>
            <button class="theme-toggle" id="themeToggle">${dark ? SUN_ICON : MOON_ICON}</button>
          </div>
          <i>(*) The information below may contain discrepancies.<br/>
          For the most accurate details, please contact HR.</i>

          <label for="joiningDate">When did you join Mantu?</label>
          <input type="date" id="joiningDate" value="${existingJoiningDate}"/>

          <label for="remaining2025">Number of day-offs carried over from 2025</label>
          <input type="number" id="remaining2025" min="0" max="${MAX_CARRYOVER_DAYS}" step="${DAYOFF_INPUT_STEP}" value="${existingRemaining}"/>
          <div class="error" id="remaining2025Error">Value must be between 0 and ${MAX_CARRYOVER_DAYS}, in increments of ${DAYOFF_INPUT_STEP}</div>

          <div class="footer">
            <button id="cancelBtn" class="btn secondaryBtn">Cancel</button>
            <button id="confirmBtn" class="btn primaryBtn" disabled>Confirm</button>
          </div>
          <div class="version">${VERSION}</div>
        </div>
      </div>
    `;

    const joiningDateInput = shadowRoot.querySelector("#joiningDate");
    const remainingInput = shadowRoot.querySelector("#remaining2025");
    const confirmBtn = shadowRoot.querySelector("#confirmBtn");
    const errorEl = shadowRoot.querySelector("#remaining2025Error");

    shadowRoot.querySelector("#themeToggle").addEventListener("click", toggleTheme);

    function validateForm() {
      const joiningDateVal = joiningDateInput.value;
      const remainingVal = parseFloat(remainingInput.value);
      const isRemainingValid =
        !isNaN(remainingVal) &&
        remainingVal >= 0 &&
        remainingVal <= MAX_CARRYOVER_DAYS &&
        remainingVal % DAYOFF_INPUT_STEP === 0;

      errorEl.style.display = remainingInput.value !== "" && !isRemainingValid ? "block" : "none";
      confirmBtn.disabled = !joiningDateVal || !isRemainingValid;
    }

    joiningDateInput.addEventListener("input", validateForm);
    remainingInput.addEventListener("input", validateForm);
    validateForm();

    shadowRoot.querySelector("#cancelBtn").addEventListener("click", () => {
      document.getElementById(CALCULATOR_ELEMENT_ID)?.remove();
    });

    confirmBtn.addEventListener("click", () => {
      const joiningDateVal = joiningDateInput.value;
      const remainingVal = parseFloat(remainingInput.value);

      const isRemainingValid =
        !isNaN(remainingVal) &&
        remainingVal >= 0 &&
        remainingVal <= MAX_CARRYOVER_DAYS &&
        remainingVal % DAYOFF_INPUT_STEP === 0;
      if (!joiningDateVal || !isRemainingValid) return;

      localStorage.setItem(JOINING_DATE_STORAGE_KEY, joiningDateVal);
      localStorage.setItem(REMAINING_2025_DAYOFF_STORAGE_KEY, String(remainingVal));
      document.getElementById(CALCULATOR_ELEMENT_ID)?.remove();

      onConfirm();
    });
  }

  /**
   * Shows the result modal with per-year day-off breakdown.
   * - "Update" button reopens the input modal to change user data
   * - "Close" button dismisses the modal
   */
  function showResultModal() {
    document.getElementById(CALCULATOR_ELEMENT_ID)?.remove();

    const containerDiv = document.createElement("div");
    containerDiv.id = CALCULATOR_ELEMENT_ID;
    document.body.appendChild(containerDiv);

    const shadowRoot = containerDiv.attachShadow({ mode: "open" });
    const dark = document.body.classList.contains("body--dark");

    shadowRoot.innerHTML = `
      <style>
        .modal-overlay {
          position: fixed;
          top: 0; left: 0;
          width: 100%; height: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          backdrop-filter: blur(1px);
          background-color: rgba(0, 0, 0, 0.3);
          z-index: 9999;
        }
        .modal-content {
          background: ${dark ? "#1d1d1d" : "white"};
          color: ${dark ? "#e0e0e0" : "inherit"};
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
          min-width: 400px;
          max-height: 80vh;
          overflow: auto;
        }
        .modal-content .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-weight: bold;
          margin-bottom: 10px;
        }
        .theme-toggle {
          background: none;
          border: 1px solid ${dark ? "#555" : "#ccc"};
          border-radius: 4px;
          padding: 4px 6px;
          cursor: pointer;
          color: ${dark ? "#e0e0e0" : "#333"};
          display: flex;
          align-items: center;
        }
        .modal-content ul { padding-left: 20px; }
        .modal-content ol { padding-left: 20px; }
        .modal-content li { margin-bottom: 4px; }
        .dayoffs-calc-info {
          max-height: 400px;
          overflow: auto;
        }
        .footer {
          margin-top: 15px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        .btn {
          color: white;
          border: none;
          padding: 10px 15px;
          border-radius: 4px;
          cursor: pointer;
        }
        .secondaryBtn { background: #9E9E9E; }
        .primaryBtn { background: #6d2077; }
        .version {
          margin-top: 20px;
          text-align: right;
          font-size: smaller;
          font-style: italic;
        }
      </style>
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="header">
            <span>Mantu Day-off Calculator V2</span>
            <button class="theme-toggle" id="themeToggle">${dark ? SUN_ICON : MOON_ICON}</button>
          </div>
          <i>(*) The information below may contain discrepancies.<br/>
          For the most accurate details, please contact HR.</i>
          <div id="dayoffCalcInfo" class="dayoffs-calc-info"></div>
          <div class="footer">
            <button id="updateBtn" class="btn primaryBtn">Update</button>
            <button id="cancelBtn" class="btn secondaryBtn">Close</button>
          </div>
          <div class="version">${VERSION}</div>
        </div>
      </div>
    `;

    renderDayoffInfo(shadowRoot);

    shadowRoot.querySelector("#themeToggle").addEventListener("click", toggleTheme);

    shadowRoot.querySelector("#cancelBtn").addEventListener("click", () => {
      document.getElementById(CALCULATOR_ELEMENT_ID)?.remove();
    });

    shadowRoot.querySelector("#updateBtn").addEventListener("click", () => {
      showInputModal(showResultModal);
    });
  }

  /* --- Main entry point --- */

  /* Step 1: Redirect to the holidays history page if not already there */
  if (!window.location.href.startsWith(HOLIDAYS_PAGE_BASE) && !document.getElementById(CALCULATOR_ELEMENT_ID)) {
    window.location.href = HOLIDAYS_PAGE_URL;
    return;
  }

  /* Step 2: Ensure all table rows are visible (select max rows if needed) */
  if (!document.getElementById(CALCULATOR_ELEMENT_ID)) {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("limit") !== MAX_ROWS_PER_PAGE) {
      document.querySelector("div.q-table__bottom .q-field__native.row.items-center").click();

      await new Promise((resolve) => setTimeout(resolve, TABLE_RENDER_DELAY_MS));

      const maxRowsOption = Array.from(document.querySelectorAll(".q-item__label span"))
        .find((s) => s.textContent.trim() === MAX_ROWS_PER_PAGE);
      if (maxRowsOption) maxRowsOption.click();

      await new Promise((resolve) => setTimeout(resolve, TABLE_RENDER_DELAY_MS));
    }
  }

  /* Step 3: Show input modal if data missing, otherwise show results directly */
  if (!getJoiningDate() || getRemaining2025Dayoff() === null) {
    showInputModal(showResultModal);
  } else {
    showResultModal();
  }

})();
