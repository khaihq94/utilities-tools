(() => {
  'use strict';

  // ─── Constants ───
  const BASE_URL = 'https://www.vietjetair.com/vi/my/search-booking';
  const SCRIPT_ID = 'vietjet-booking-lookup';
  const INPUT_FILL_DELAY_MS = 300;

  // ─── Booking Options ───
  // Each entry: { key, reservationCode, firstName, lastName }
  const BOOKING_OPTIONS = [
    { key: 'CXR-SGN Ba', reservationCode: 'WUG3M3', firstName: 'Do', lastName: 'The Tang' },
    { key: 'CXR-SGN Khai', reservationCode: 'BEMTAQ', firstName: 'Ho', lastName: 'Quang Khai' },
  ];

  // ─── Page Detection & Redirect ───
  if (!window.location.href.startsWith(BASE_URL)) {
    window.location.href = BASE_URL;
    return;
  }

  // Prevent duplicate injection
  if (document.getElementById(SCRIPT_ID)) {
    console.log('[VietjetBookingLookup] Already active');
    return;
  }

  // ─── Modal UI ───
  const host = document.createElement('div');
  host.id = SCRIPT_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .dialog {
      background: #fff;
      border-radius: 12px;
      padding: 24px;
      min-width: 340px;
      max-width: 420px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    }
    .title {
      margin: 0 0 16px;
      font-size: 18px;
      font-weight: 600;
      color: #333;
    }
    label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      font-weight: 500;
      color: #555;
    }
    select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ccc;
      border-radius: 8px;
      font-size: 14px;
      background: #fafafa;
      cursor: pointer;
      outline: none;
    }
    select:focus {
      border-color: #e04040;
    }
    .btn-row {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    }
    button {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .btn-cancel {
      background: #eee;
      color: #333;
    }
    .btn-confirm {
      background: #e04040;
      color: #fff;
    }
    .btn-confirm:not(:disabled):hover {
      opacity: 0.85;
    }
    .btn-cancel:hover {
      background: #ddd;
    }
  `;
  shadow.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="dialog">
      <h2 class="title">Vietjet Booking Lookup</h2>
      <label for="booking-select">Choose a booking</label>
      <select id="booking-select">
        <option value="" disabled selected>-- Select --</option>
      </select>
      <div class="btn-row">
        <button class="btn-cancel" type="button">Cancel</button>
        <button class="btn-confirm" type="button" disabled>Confirm</button>
      </div>
    </div>
  `;
  shadow.appendChild(overlay);

  const selectEl = shadow.getElementById('booking-select');
  const confirmBtn = shadow.querySelector('.btn-confirm');
  const cancelBtn = shadow.querySelector('.btn-cancel');

  // Populate dropdown
  BOOKING_OPTIONS.forEach((opt, idx) => {
    const option = document.createElement('option');
    option.value = idx;
    option.textContent = opt.key;
    selectEl.appendChild(option);
  });

  selectEl.addEventListener('change', () => {
    confirmBtn.disabled = selectEl.value === '';
  });

  /** Remove the modal from DOM */
  function closeModal() {
    host.remove();
  }

  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });

  /**
   * Set a value on an input element, dispatching events so frameworks (Vue/React/Angular) pick it up.
   * @param {HTMLInputElement} input
   * @param {string} value
   */
  function fillInput(input, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  confirmBtn.addEventListener('click', () => {
    const selected = BOOKING_OPTIONS[selectEl.value];
    if (!selected) {
      return;
    }

    closeModal();

    // Find inputs on the page and fill them
    setTimeout(() => {
      const reservationInput = document.querySelector('input[name="reservationLocator"]');
      const firstNameInput = document.querySelector('input[name="passengerFamilyName"]');
      const lastNameInput = document.querySelector('input[name="passengerMiddleGivenName"]');

      if (reservationInput) {
        fillInput(reservationInput, selected.reservationCode);
        console.log('[VietjetBookingLookup] Filled reservation:', selected.reservationCode);
      } else {
        console.warn('[VietjetBookingLookup] Reservation input not found');
      }

      if (firstNameInput) {
        fillInput(firstNameInput, selected.firstName);
        console.log('[VietjetBookingLookup] Filled firstName:', selected.firstName);
      } else {
        console.warn('[VietjetBookingLookup] First name input not found');
      }

      if (lastNameInput) {
        fillInput(lastNameInput, selected.lastName);
        console.log('[VietjetBookingLookup] Filled lastName:', selected.lastName);
      } else {
        console.warn('[VietjetBookingLookup] Last name input not found');
      }

      // Press the search/submit button
      const submitBtn = document.querySelector(
        'button[type="submit"], button.btn-search, button.search-btn, form button'
      );
      if (submitBtn) {
        submitBtn.click();
        console.log('[VietjetBookingLookup] Clicked submit button');
      } else {
        // Fallback: press Enter on the last filled input
        const lastFilled = lastNameInput || firstNameInput || reservationInput;
        if (lastFilled) {
          lastFilled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          lastFilled.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }));
          lastFilled.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
          console.log('[VietjetBookingLookup] Dispatched Enter key');
        }
      }
    }, INPUT_FILL_DELAY_MS);
  });

  console.log('[VietjetBookingLookup] Dialog opened');
})();
