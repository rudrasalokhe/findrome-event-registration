/**
 * Findrome NMIMS — Event Registration Form
 * Frontend Controller & Dynamic QR Pass Generator
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── Elements ──
  const form = document.getElementById('registration-form');
  const submitBtn = document.getElementById('submit-btn');
  const serverAlert = document.getElementById('server-alert');
  const serverAlertMsg = document.getElementById('server-alert-message');
  
  // Fields
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const phoneInput = document.getElementById('phone');
  const sapInput = document.getElementById('sap_id');
  const programSelect = document.getElementById('program');
  const yearSelect = document.getElementById('year_of_study');
  const branchInput = document.getElementById('branch');

  // Counters
  const phoneCounter = document.getElementById('phone-counter');
  const sapCounter = document.getElementById('sap-counter');

  // Pass Modal Elements
  const successModal = document.getElementById('success-modal');
  const btnRegisterAnother = document.getElementById('btn-register-another');
  const btnPrintPass = document.getElementById('btn-print-pass');
  const ticketQrCodeContainer = document.getElementById('ticket-qrcode-render');
  const ticketStatusPill = document.getElementById('ticket-status-pill');

  // Lookup Modal Elements
  const lookupModal = document.getElementById('lookup-modal');
  const openLookupBtn = document.getElementById('open-lookup-btn');
  const closeLookupBtn = document.getElementById('btn-close-lookup');
  const lookupForm = document.getElementById('lookup-form');
  const lookupInput = document.getElementById('lookup-query-input');
  const lookupError = document.getElementById('lookup-error-msg');
  const btnSubmitLookup = document.getElementById('btn-submit-lookup');

  // Database Records Modal Elements
  const recordsModal = document.getElementById('records-modal');
  const openRecordsBtn = document.getElementById('open-registrations-btn');
  const viewRecordsFooterBtn = document.getElementById('view-records-footer-btn');
  const closeRecordsBtn = document.getElementById('btn-close-records');
  const recordsList = document.getElementById('records-list');

  // Regex patterns
  const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;

  let qrCodeInstance = null;

  // ── Helper: Set Field Error ──
  function setFieldError(fieldId, message) {
    const group = document.getElementById(`group-${fieldId}`);
    const errorEl = document.getElementById(`${fieldId}-error`) || document.getElementById(`${fieldId.replace('_', '')}-error`);
    
    if (group) {
      group.classList.add('has-error');
    }
    if (errorEl) {
      const span = errorEl.querySelector('span');
      if (span) span.textContent = message;
      errorEl.style.display = 'flex';
    }
  }

  // ── Helper: Clear Field Error ──
  function clearFieldError(fieldId) {
    const group = document.getElementById(`group-${fieldId}`);
    const errorEl = document.getElementById(`${fieldId}-error`) || document.getElementById(`${fieldId.replace('_', '')}-error`);
    
    if (group) {
      group.classList.remove('has-error');
    }
    if (errorEl) {
      errorEl.style.display = 'none';
    }
  }

  function clearAllErrors() {
    ['name', 'email', 'phone', 'sap_id', 'program', 'year_of_study', 'branch'].forEach(clearFieldError);
    serverAlert.className = 'server-alert';
    serverAlert.style.display = 'none';
  }

  // ── Real-time Input Sanitization & Digit Counters ──
  phoneInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
    const count = e.target.value.length;
    phoneCounter.textContent = `${count}/10 digits`;
    phoneCounter.classList.toggle('valid', count === 10);
    if (count === 10) clearFieldError('phone');
  });

  sapInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);
    const count = e.target.value.length;
    sapCounter.textContent = `${count}/11 digits`;
    sapCounter.classList.toggle('valid', count === 11);
    if (count === 11) clearFieldError('sap_id');
  });

  nameInput.addEventListener('input', () => {
    if (nameInput.value.trim().length > 0) clearFieldError('name');
  });

  emailInput.addEventListener('input', () => {
    if (EMAIL_REGEX.test(emailInput.value.trim())) clearFieldError('email');
  });

  programSelect.addEventListener('change', () => {
    if (programSelect.value) clearFieldError('program');
  });

  yearSelect.addEventListener('change', () => {
    if (yearSelect.value) clearFieldError('year_of_study');
  });

  branchInput.addEventListener('input', () => {
    if (branchInput.value.trim().length > 0) clearFieldError('branch');
  });

  // ── Client-Side Validation Logic ──
  function validateForm() {
    let isValid = true;
    let firstInvalidElement = null;

    clearAllErrors();

    // 1. Name
    const nameVal = nameInput.value.trim();
    if (!nameVal) {
      setFieldError('name', 'This field is required.');
      isValid = false;
      if (!firstInvalidElement) firstInvalidElement = nameInput;
    }

    // 2. Email
    const emailVal = emailInput.value.trim();
    if (!emailVal) {
      setFieldError('email', 'This field is required.');
      isValid = false;
      if (!firstInvalidElement) firstInvalidElement = emailInput;
    } else if (!EMAIL_REGEX.test(emailVal)) {
      setFieldError('email', 'Please enter a valid email address.');
      isValid = false;
      if (!firstInvalidElement) firstInvalidElement = emailInput;
    }

    // 3. Phone (exactly 10 digits)
    const phoneVal = phoneInput.value.trim();
    if (!phoneVal) {
      setFieldError('phone', 'This field is required.');
      isValid = false;
      if (!firstInvalidElement) firstInvalidElement = phoneInput;
    } else if (phoneVal.length !== 10 || !/^\d{10}$/.test(phoneVal)) {
      setFieldError('phone', 'Phone number must be exactly 10 digits.');
      isValid = false;
      if (!firstInvalidElement) firstInvalidElement = phoneInput;
    }

    // 4. SAP ID (exactly 11 digits)
    const sapVal = sapInput.value.trim();
    if (!sapVal) {
      setFieldError('sap_id', 'This field is required.');
      isValid = false;
      if (!firstInvalidElement) firstInvalidElement = sapInput;
    } else if (sapVal.length !== 11 || !/^\d{11}$/.test(sapVal)) {
      setFieldError('sap_id', 'SAP ID must be exactly 11 digits.');
      isValid = false;
      if (!firstInvalidElement) firstInvalidElement = sapInput;
    }

    // 5. Program / Degree
    const programVal = programSelect.value;
    if (!programVal) {
      setFieldError('program', 'Please select your program / degree.');
      isValid = false;
      if (!firstInvalidElement) firstInvalidElement = programSelect;
    }

    // 6. Year of Study
    const yearVal = yearSelect.value;
    if (!yearVal) {
      setFieldError('year_of_study', 'Please select your year of study.');
      isValid = false;
      if (!firstInvalidElement) firstInvalidElement = yearSelect;
    }

    // 7. Branch
    const branchVal = branchInput.value.trim();
    if (!branchVal) {
      setFieldError('branch', 'This field is required.');
      isValid = false;
      if (!firstInvalidElement) firstInvalidElement = branchInput;
    }

    if (firstInvalidElement) {
      firstInvalidElement.focus();
      firstInvalidElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return isValid;
  }

  // ── Render Scannable QR Code (High-Contrast for Fast Gate Camera Scans) ──
  function renderTicketQrCode(textPayload) {
    const qrContainer = document.getElementById('ticket-qrcode-render');
    if (!qrContainer) return;
    qrContainer.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      qrCodeInstance = new QRCode(qrContainer, {
        text: textPayload,
        width: 118,
        height: 118,
        colorDark: "#0d110f",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      qrContainer.textContent = textPayload;
    }
  }

  // ── Display Delegate Pass Modal ──
  function showDelegatePass(record) {
    document.getElementById('ticket-id-display').textContent = record.registration_id;
    document.getElementById('ticket-name-display').textContent = record.name;
    document.getElementById('ticket-sap-display').textContent = record.sap_id;
    document.getElementById('ticket-program-display').textContent = `${record.program} • ${record.year_of_study}`;
    document.getElementById('ticket-branch-display').textContent = record.branch;
    const activeDates = record.event_dates || document.getElementById('hero-event-dates-display')?.textContent || 'Event Dates';
    const activeVenue = record.event_venue || document.getElementById('hero-event-venue-display')?.textContent || 'NMIMS Campus';
    const timeEl = document.getElementById('ticket-time-display');
    const venueEl = document.getElementById('ticket-venue-display');
    if (timeEl) timeEl.textContent = activeDates;
    if (venueEl) venueEl.textContent = activeVenue;

    if (record.status === 'CHECKED_IN') {
      ticketStatusPill.className = 'pass-status-pill admitted';
      ticketStatusPill.textContent = 'ADMITTED (CHECKED IN)';
    } else {
      ticketStatusPill.className = 'pass-status-pill confirmed';
      ticketStatusPill.textContent = 'CONFIRMED DELEGATE';
    }

    // Render QR code containing the unique Pass ID
    renderTicketQrCode(record.registration_id);

    // Display modal
    successModal.classList.add('active');
  }

  // ── Form Submit Handler ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const payload = {
      name: nameInput.value.trim(),
      email: emailInput.value.trim(),
      phone: phoneInput.value.trim(),
      sap_id: sapInput.value.trim(),
      program: programSelect.value,
      year_of_study: yearSelect.value,
      branch: branchInput.value.trim()
    };

    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    submitBtn.querySelector('.btn-text').textContent = 'Submitting...';

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Reset inputs
        form.reset();
        phoneCounter.textContent = '0/10 digits';
        phoneCounter.classList.remove('valid');
        sapCounter.textContent = '0/11 digits';
        sapCounter.classList.remove('valid');

        // Present Digital Pass
        showDelegatePass(result.data);
        fetchLiveCount();
      } else {
        if (result.errors) {
          Object.keys(result.errors).forEach((field) => {
            setFieldError(field, result.errors[field]);
          });
          const firstErrField = Object.keys(result.errors)[0];
          const el = document.getElementById(firstErrField);
          if (el) el.focus();
        } else {
          serverAlert.className = 'server-alert error';
          serverAlertMsg.textContent = result.message || 'Registration failed. Please review your information.';
          serverAlert.style.display = 'flex';
        }
      }
    } catch (err) {
      console.error('Error submitting form:', err);
      serverAlert.className = 'server-alert error';
      serverAlertMsg.textContent = 'Network error. Please check that the Flask server is running.';
      serverAlert.style.display = 'flex';
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      submitBtn.querySelector('.btn-text').textContent = 'Submit Registration';
    }
  });

  // ── Pass Retrieval ("Find My Pass") ──
  openLookupBtn.addEventListener('click', () => {
    lookupError.style.display = 'none';
    lookupInput.value = '';
    lookupModal.classList.add('active');
    setTimeout(() => lookupInput.focus(), 150);
  });

  closeLookupBtn.addEventListener('click', () => {
    lookupModal.classList.remove('active');
  });

  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = lookupInput.value.trim();
    if (!query) return;

    btnSubmitLookup.disabled = true;
    btnSubmitLookup.textContent = 'Searching...';
    lookupError.style.display = 'none';

    try {
      const res = await fetch(`/api/lookup?query=${encodeURIComponent(query)}`);
      const result = await res.json();

      if (res.ok && result.success) {
        lookupModal.classList.remove('active');
        showDelegatePass(result.data);
      } else {
        lookupError.textContent = result.message || 'No registration pass found for this SAP ID or Email.';
        lookupError.style.display = 'block';
      }
    } catch (err) {
      lookupError.textContent = 'Server connection error. Please try again.';
      lookupError.style.display = 'block';
    } finally {
      btnSubmitLookup.disabled = false;
      btnSubmitLookup.textContent = 'Search';
    }
  });

  // ── Modal Actions ──
  btnRegisterAnother.addEventListener('click', () => {
    successModal.classList.remove('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    nameInput.focus();
  });

  btnPrintPass.addEventListener('click', () => {
    window.print();
  });

  [successModal, recordsModal, lookupModal].forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  });

  // ── Live Registrations Drawer / Database Viewer ──
  async function fetchLiveCount() {
    try {
      const res = await fetch('/api/registrations');
      if (res.ok) {
        const data = await res.json();
        liveCountText.textContent = `Registrations: ${data.total} Live`;
      }
    } catch {
      liveCountText.textContent = 'Live DB Connected';
    }
  }

  async function openRecordsDrawer() {
    recordsModal.classList.add('active');
    recordsList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 20px;">Fetching from SQLite database...</p>';

    try {
      const res = await fetch('/api/registrations');
      const data = await res.json();

      if (!data.registrations || data.registrations.length === 0) {
        recordsList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 20px;">No registrations recorded yet. Submit the form above!</p>';
        return;
      }

      recordsList.innerHTML = data.registrations.map(r => `
        <div class="registration-item-card">
          <div class="reg-item-left">
            <span class="reg-item-name">${escapeHtml(r.name)}</span>
            <span class="reg-item-meta">SAP: ${escapeHtml(r.sap_id)} • ${escapeHtml(r.program)} (${escapeHtml(r.year_of_study)})</span>
            <span class="reg-item-meta" style="color: var(--text-dim); font-size: 0.74rem;">${escapeHtml(r.branch)} • Status: ${escapeHtml(r.status || 'CONFIRMED')}</span>
          </div>
          <span class="reg-item-badge">${escapeHtml(r.registration_id)}</span>
        </div>
      `).join('');
    } catch (err) {
      recordsList.innerHTML = '<p style="color: var(--error-color); font-size: 0.9rem; text-align: center; padding: 20px;">Failed to load records.</p>';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  openRecordsBtn.addEventListener('click', openRecordsDrawer);
  viewRecordsFooterBtn.addEventListener('click', openRecordsDrawer);
  closeRecordsBtn.addEventListener('click', () => recordsModal.classList.remove('active'));

  // Initial load
  fetchLiveCount();
});
