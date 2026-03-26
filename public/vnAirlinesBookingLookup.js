(() => {
  'use strict';

  // ─── Constants ───
  const BASE_URL = 'https://www.vietnamairlines.com/vn/vi/buy-tickets-other-products/booking-and-manage-bookings/reservation-management';
  const SCRIPT_ID = 'vna-booking-lookup';
  const INPUT_FILL_DELAY_MS = 300;

  // ─── Booking Options ───
  // Each entry: { key, bookingCode, lastName }
  const BOOKING_OPTIONS = [
    { key: 'SGN-CXR Ba', bookingCode: 'E5WQC5', lastName: 'Do' },
    { key: 'SGN-CXR Khai', bookingCode: 'DU9JTC', lastName: 'Ho' },
  ];

  // ─── Page Detection & Redirect ───
  if (!window.location.href.startsWith(BASE_URL)) {
    window.location.href = BASE_URL;
    return;
  }

  // Prevent duplicate injection
  if (document.getElementById(SCRIPT_ID)) {
    console.log('[VNABookingLookup] Already active');
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
      border-color: #006a4e;
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
      background: #006a4e;
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
      <h2 class="title">Vietnam Airlines Booking Lookup</h2>
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
   * Find an input whose id starts with the given prefix.
   * @param {string} prefix
   * @returns {HTMLInputElement|null}
   */
  function findInputByIdPrefix(prefix) {
    return document.querySelector(`input[id^="${prefix}"]`);
  }

  /**
   * Set a value on an input element, dispatching events so frameworks pick it up.
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
      const bookingCodeInput = findInputByIdPrefix('bookingcode-input-');
      const lastNameInput = findInputByIdPrefix('lastname-input-');

      if (bookingCodeInput) {
        fillInput(bookingCodeInput, selected.bookingCode);
        console.log('[VNABookingLookup] Filled booking code:', selected.bookingCode);
      } else {
        console.warn('[VNABookingLookup] Booking code input not found');
      }

      if (lastNameInput) {
        fillInput(lastNameInput, selected.lastName);
        console.log('[VNABookingLookup] Filled last name:', selected.lastName);
      } else {
        console.warn('[VNABookingLookup] Last name input not found');
      }

      // Click the search button
      const submitBtn = document.querySelector('button.btnCodeFlyFinding');
      if (submitBtn) {
        submitBtn.click();
        console.log('[VNABookingLookup] Clicked submit button');
      } else {
        console.warn('[VNABookingLookup] Submit button (.btnCodeFlyFinding) not found');
      }
    }, INPUT_FILL_DELAY_MS);
  });

  console.log('[VNABookingLookup] Dialog opened');
})();
