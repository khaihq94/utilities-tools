!(async function () {
  const VERSION = "v2.0.0";
  const HOLIDAYS_PAGE_URL =
    "https://timesheet.arp.mantu.com/my-history?startDate=2021-01-01&absenceCategoryId=4&absenceCategoryParentId=1&orderBy=startDate&descending=true&page=1&limit=7&tab=pendingHolidays";
  const CALCULATOR_ELEMENT_ID = "mantuDayoffCalculator";
  const JOINING_DATE_STORAGE_KEY = "mantu-dayoff-calculator-joining-date";
  const REMAINING_2025_DAYOFF_STORAGE_KEY = "mantu-dayoff-calculator-remaining-2025";
  const BASE_DAYOFF_ALLOWANCE = 14;
  const YEARLY_INCREMENT = 0.5;
  const MAX_CARRYOVER_DAYS = 5;
  const RESET_DAY = 30;
  const RESET_MONTH = 4;
  const ONE_DAY_MS = 864e5;
  const MAX_ROWS_PER_PAGE = "100";
  const DEBUG_MODE = false;
  const CURRENT_YEAR = new Date().getFullYear();
  const FIRST_CALCULATED_YEAR = 2026;

  const MONTH_ABBR = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  };

  let publicHolidays = null;
  let publicHolidaySets = {};

  /* --- Utilities --- */

  function debugLog(message) {
    if (DEBUG_MODE) console.error(message);
  }

  function getDaysInMonth(month, year) {
    return new Date(year, month, 0).getDate();
  }

  function getHolidaySet(year) {
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

  /* --- Data access --- */

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

  function getRemaining2025Dayoff() {
    const stored = localStorage.getItem(REMAINING_2025_DAYOFF_STORAGE_KEY);
    if (stored === null) return null;
    return parseFloat(stored);
  }

  function parseHolidayRows() {
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

  /* --- Core calculation (from v1) --- */

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

    const holidaySet = getHolidaySet(splitYear);

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
        countDays(startDate, splitDate) + (startAMPM === "PM" ? -0.5 : 0),
      daysAfterPoint:
        countDays(dayAfterSplit, endDate) + (endAMPM === "AM" ? -0.5 : 0),
    };
  }

  function isBeforeResetInSameYear(entry, year) {
    return (
      entry.startYear === entry.endYear &&
      entry.endYear === year &&
      entry.endMonth <= RESET_MONTH
    );
  }

  function calculateYearDayoffs(year, carriedOverDays) {
    debugLog(`Year: ${year}`);

    const allEntries = parseHolidayRows();
    const joiningDate = getJoiningDate();
    const { day: joiningDay, month: joiningMonth, year: joiningYear } = joiningDate;
    const yearsSinceJoining = year - joiningYear;
    const previousYearsSinceJoining = Math.max(0, yearsSinceJoining - 1);

    /* Calculate proportional allowance based on joining month */
    let fullMonthsBeforeJoining = 0;
    let monthsAfterJoining = 12 - joiningMonth;
    let daysBeforeJoiningInMonth = 0;
    let daysAfterJoiningInMonth = 0;
    const joiningMonthLength = getDaysInMonth(joiningMonth, year);

    if (year !== joiningYear) {
      fullMonthsBeforeJoining = joiningMonth - 1;
      const { daysUntilPoint, daysAfterPoint } = calculateDaysBetween(
        [1, joiningMonth, year],
        "AM",
        [joiningMonthLength, joiningMonth, year],
        "PM",
        [joiningDay - 1, joiningMonth, year],
        true
      );
      daysBeforeJoiningInMonth = daysUntilPoint;
      daysAfterJoiningInMonth = daysAfterPoint;
    } else {
      const { daysAfterPoint } = calculateDaysBetween(
        [1, joiningMonth, year],
        "AM",
        [joiningMonthLength, joiningMonth, year],
        "AM",
        [joiningDay - 1, joiningMonth, year],
        true
      );
      daysAfterJoiningInMonth = daysAfterPoint;
    }

    const totalAllowedDayoffs =
      ((BASE_DAYOFF_ALLOWANCE + previousYearsSinceJoining * YEARLY_INCREMENT) / 12) *
        (fullMonthsBeforeJoining + daysBeforeJoiningInMonth / joiningMonthLength) +
      ((BASE_DAYOFF_ALLOWANCE + yearsSinceJoining * YEARLY_INCREMENT) / 12) *
        (daysAfterJoiningInMonth / joiningMonthLength + monthsAfterJoining);

    debugLog(`totalAllowedDayoff: ${totalAllowedDayoffs}`);

    /* Tally validated dayoffs for this year */
    let totalDayoffsTaken = 0;
    let dayoffsTakenBeforeReset = 0;

    const validatedEntries = allEntries.filter((entry) => {
      if (entry.status !== "Validated") return false;
      const isSameYear = entry.startYear === entry.endYear && entry.endYear === year;
      const startsBeforeYear = entry.startYear < year && entry.endYear === year;
      const endsAfterYear = entry.startYear === year && entry.endYear > year;
      return isSameYear || startsBeforeYear || endsAfterYear;
    });

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
      if (isBeforeResetInSameYear(entry, year)) {
        dayoffsTakenBeforeReset += entry.days;
      }

      /* Spans across the reset date (April -> May) */
      if (entry.startMonth <= RESET_MONTH && entry.endMonth > RESET_MONTH) {
        const { daysUntilPoint, daysAfterPoint } = calculateDaysBetween(
          entryStart, entry.startAMPM,
          entryEnd, entry.endAMPM,
          [RESET_DAY, RESET_MONTH, year]
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
          <li>Dayoffs taken before ${RESET_DAY}-${RESET_MONTH}-${year}: <b>${result.dayoffsTakenBeforeReset.toFixed(2)}</b> days</li>
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

  /* --- Modal --- */

  function showInputModal(onConfirm) {
    document.getElementById(CALCULATOR_ELEMENT_ID)?.remove();

    const containerDiv = document.createElement("div");
    containerDiv.id = CALCULATOR_ELEMENT_ID;
    document.body.appendChild(containerDiv);

    const shadowRoot = containerDiv.attachShadow({ mode: "open" });
    const existingJoiningDate = localStorage.getItem(JOINING_DATE_STORAGE_KEY) || "";
    const existingRemaining = localStorage.getItem(REMAINING_2025_DAYOFF_STORAGE_KEY) || "";
    const isDarkMode = document.body.classList.contains("body--dark");

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
          background: ${isDarkMode ? "#1d1d1d" : "white"};
          color: ${isDarkMode ? "#e0e0e0" : "inherit"};
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
          min-width: 350px;
        }
        .modal-content .header {
          font-weight: bold;
          margin-bottom: 10px;
        }
        .modal-content label {
          display: block;
          margin-bottom: 5px;
          margin-top: 10px;
        }
        .modal-content input {
          padding: 8px;
          border: 1px solid ${isDarkMode ? "#555" : "#ccc"};
          border-radius: 4px;
          width: 100%;
          box-sizing: border-box;
          background: ${isDarkMode ? "#2c2c2c" : "white"};
          color: ${isDarkMode ? "#e0e0e0" : "inherit"};
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
        .version {
          margin-top: 20px;
          text-align: right;
          font-size: smaller;
          font-style: italic;
        }
      </style>
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="header">Mantu Day-off Calculator V2</div>
          <i>(*) The information below may contain discrepancies.<br/>
          For the most accurate details, please contact HR.</i>

          <label for="joiningDate">When did you join Mantu?</label>
          <input type="date" id="joiningDate" value="${existingJoiningDate}"/>

          <label for="remaining2025">Number of day-offs carried over from 2025</label>
          <input type="number" id="remaining2025" min="0" max="5" step="0.5" value="${existingRemaining}"/>
          <div class="error" id="remaining2025Error">Value must be between 0 and 5, in increments of 0.5</div>

          <div class="footer">
            <button id="cancelBtn" class="btn secondaryBtn">Cancel</button>
            <button id="confirmBtn" class="btn primaryBtn">Confirm</button>
          </div>
          <div class="version">${VERSION}</div>
        </div>
      </div>
    `;

    shadowRoot.querySelector("#cancelBtn").addEventListener("click", () => {
      document.getElementById(CALCULATOR_ELEMENT_ID)?.remove();
    });

    shadowRoot.querySelector("#confirmBtn").addEventListener("click", () => {
      const joiningDateVal = shadowRoot.querySelector("#joiningDate").value;
      const remainingVal = parseFloat(shadowRoot.querySelector("#remaining2025").value);
      const errorEl = shadowRoot.querySelector("#remaining2025Error");

      /* Validate remaining dayoff: 0 to 5, step 0.5 */
      if (
        isNaN(remainingVal) ||
        remainingVal < 0 ||
        remainingVal > 5 ||
        remainingVal % 0.5 !== 0
      ) {
        errorEl.style.display = "block";
        return;
      }
      errorEl.style.display = "none";

      if (!joiningDateVal) return;

      localStorage.setItem(JOINING_DATE_STORAGE_KEY, joiningDateVal);
      localStorage.setItem(REMAINING_2025_DAYOFF_STORAGE_KEY, String(remainingVal));
      document.getElementById(CALCULATOR_ELEMENT_ID)?.remove();

      onConfirm();
    });
  }

  function showResultModal() {
    document.getElementById(CALCULATOR_ELEMENT_ID)?.remove();

    const containerDiv = document.createElement("div");
    containerDiv.id = CALCULATOR_ELEMENT_ID;
    document.body.appendChild(containerDiv);

    const shadowRoot = containerDiv.attachShadow({ mode: "open" });
    const isDarkMode = document.body.classList.contains("body--dark");

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
          background: ${isDarkMode ? "#1d1d1d" : "white"};
          color: ${isDarkMode ? "#e0e0e0" : "inherit"};
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
          min-width: 400px;
          max-height: 80vh;
          overflow: auto;
        }
        .modal-content .header {
          font-weight: bold;
          margin-bottom: 10px;
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
          <div class="header">Mantu Day-off Calculator V2</div>
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

    shadowRoot.querySelector("#cancelBtn").addEventListener("click", () => {
      document.getElementById(CALCULATOR_ELEMENT_ID)?.remove();
    });

    shadowRoot.querySelector("#updateBtn").addEventListener("click", () => {
      showInputModal(showResultModal);
    });
  }

  /* --- Main --- */

  if (window.location.href !== HOLIDAYS_PAGE_URL && !document.getElementById(CALCULATOR_ELEMENT_ID)) {
    window.location.href = HOLIDAYS_PAGE_URL;
    return;
  }

  if (!document.getElementById(CALCULATOR_ELEMENT_ID)) {
    document.querySelector("div.q-table__bottom .q-field__native.row.items-center").click();

    await new Promise((resolve) => setTimeout(resolve, 500));

    const maxRowsOption = Array.from(document.querySelectorAll(".q-item__label span"))
      .find((s) => s.textContent.trim() === MAX_ROWS_PER_PAGE);
    if (maxRowsOption) maxRowsOption.click();
  }

  /* Fetch public holidays */
  if (!publicHolidays) {
    const response = await fetch(
      "https://utilitiestools.netlify.app/public-holidays/vn.json"
    );
    publicHolidays = await response.json();
  }

  /* Show input modal if data missing, otherwise show results */
  if (!getJoiningDate() || getRemaining2025Dayoff() === null) {
    showInputModal(showResultModal);
  } else {
    showResultModal();
  }

})();
