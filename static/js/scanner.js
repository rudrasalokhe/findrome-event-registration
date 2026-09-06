/**
 * Findrome NMIMS — Volunteer QR Scanner & Verification Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const resultModal = document.getElementById('result-modal');
  const resultCardInner = document.getElementById('result-card-inner');
  const resultIconBox = document.getElementById('result-icon-box');
  const resultTitleText = document.getElementById('result-title-text');
  const resultDescText = document.getElementById('result-desc-text');
  const resultAttendeeDetails = document.getElementById('result-attendee-details');
  const btnNextScan = document.getElementById('btn-next-scan');

  // Value slots
  const resValName = document.getElementById('res-val-name');
  const resValPass = document.getElementById('res-val-pass');
  const resValSap = document.getElementById('res-val-sap');
  const resValEmail = document.getElementById('res-val-email');
  const resValProgram = document.getElementById('res-val-program');
  const resValTime = document.getElementById('res-val-time');

  // Manual Form
  const manualForm = document.getElementById('manual-verify-form');
  const manualInput = document.getElementById('manual-code-input');

  // Metrics
  const metricTotal = document.getElementById('metric-total');
  const metricAdmitted = document.getElementById('metric-admitted');
  const metricRate = document.getElementById('metric-rate');
  const metricPending = document.getElementById('metric-pending');
  const feedContainer = document.getElementById('feed-items-container');

  // Camera Elements
  const cameraLabelText = document.getElementById('camera-label-text');
  const btnToggleCamera = document.getElementById('btn-toggle-camera');
  const laserBeam = document.getElementById('laser-beam');

  // Sound Elements
  const btnToggleSound = document.getElementById('btn-toggle-sound');
  const soundStatusIcon = document.getElementById('sound-status-icon');
  const soundStatusText = document.getElementById('sound-status-text');

  let isSoundEnabled = true;
  let isScanningActive = true;
  let autoDismissTimer = null;
  let html5QrCode = null;
  let currentCameraIndex = 0;
  let availableCameras = [];

  // ── Web Audio Synthesizer (Zero External MP3s Required) ──
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playSuccessTone() {
    if (!isSoundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // A5
      osc.frequency.exponentialRampToValueAtTime(1318.51, now + 0.12); // E6

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  function playWarningTone() {
    if (!isSoundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.setValueAtTime(240, now + 0.15);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.45);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  btnToggleSound.addEventListener('click', () => {
    isSoundEnabled = !isSoundEnabled;
    soundStatusIcon.textContent = isSoundEnabled ? '🔊' : '🔇';
    soundStatusText.textContent = `Audio: ${isSoundEnabled ? 'ON' : 'MUTED'}`;
    if (isSoundEnabled) initAudio();
  });

  // ── Verification Request Handler ──
  async function verifyPass(code) {
    if (!code) return;
    code = code.trim();

    // Prevent burst scans
    isScanningActive = false;
    laserBeam.style.display = 'none';

    try {
      const response = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code })
      });

      const result = await response.json();

      if (response.ok && result.valid) {
        if (!result.already_checked_in) {
          // CASE 1: Valid & First Time Admitted
          showResult('granted', result);
          playSuccessTone();
        } else {
          // CASE 2: Duplicate Scan (Already Admitted)
          showResult('warning', result);
          playWarningTone();
        }
      } else {
        // CASE 3: Invalid Pass / Not Found
        showResult('invalid', result);
        playWarningTone();
      }

      // Refresh stats
      fetchStats();
    } catch (err) {
      console.error('Verification error:', err);
      showResult('invalid', {
        message: 'Server connection error during verification. Check Flask server.'
      });
      playWarningTone();
    }
  }

  // ── Display Verification Modal ──
  function showResult(status, result) {
    if (autoDismissTimer) clearTimeout(autoDismissTimer);

    resultCardInner.className = 'scan-result-card';
    resultCardInner.classList.add(`status-${status}`);

    const data = result.data || {};

    if (status === 'granted') {
      resultIconBox.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="34" height="34">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
      resultTitleText.textContent = 'ACCESS GRANTED';
      resultDescText.textContent = 'Delegate verified successfully. Welcome to Findrome 2026!';
      resultAttendeeDetails.style.display = 'flex';

      resValName.textContent = data.name || '—';
      resValPass.textContent = data.registration_id || '—';
      resValSap.textContent = data.sap_id || '—';
      if (resValEmail) resValEmail.textContent = data.email || '—';
      resValProgram.textContent = `${data.program || ''} • ${data.branch || ''}`;
      resValTime.textContent = result.checked_in_at || 'Just now';

    } else if (status === 'warning') {
      resultIconBox.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="34" height="34">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      `;
      resultTitleText.textContent = 'ALREADY CHECKED IN';
      resultDescText.textContent = `Warning: This pass was already admitted at ${result.checked_in_at || 'earlier'}. Check for duplicate pass usage.`;
      resultAttendeeDetails.style.display = 'flex';

      resValName.textContent = data.name || '—';
      resValPass.textContent = data.registration_id || '—';
      resValSap.textContent = data.sap_id || '—';
      if (resValEmail) resValEmail.textContent = data.email || '—';
      resValProgram.textContent = `${data.program || ''} • ${data.branch || ''}`;
      resValTime.textContent = result.checked_in_at || 'Previously Admitted';

    } else {
      // Invalid
      resultIconBox.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="34" height="34">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
      `;
      resultTitleText.textContent = 'INVALID PASS';
      resultDescText.textContent = result.message || 'Pass not recognized in database. Please direct candidate to the helpdesk.';
      resultAttendeeDetails.style.display = 'none';
    }

    resultModal.classList.add('active');

    // Auto dismiss after 4.5 seconds
    autoDismissTimer = setTimeout(() => {
      resumeScanning();
    }, 4500);
  }

  function resumeScanning() {
    if (autoDismissTimer) clearTimeout(autoDismissTimer);
    resultModal.classList.remove('active');
    laserBeam.style.display = 'block';
    // Delay slightly to prevent scanning same frame
    setTimeout(() => {
      isScanningActive = true;
    }, 600);
  }

  btnNextScan.addEventListener('click', resumeScanning);

  resultModal.addEventListener('click', (e) => {
    if (e.target === resultModal) resumeScanning();
  });

  // ── Manual Input Form ──
  manualForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = manualInput.value.trim();
    if (code) {
      verifyPass(code);
      manualInput.value = '';
    }
  });

  // ── Fetch Event Attendance Metrics ──
  async function fetchStats() {
    try {
      const res = await fetch('/api/check-in-stats');
      if (!res.ok) return;
      const data = await res.json();

      metricTotal.textContent = data.total_registered;
      metricAdmitted.textContent = data.total_checked_in;
      metricRate.textContent = `${data.attendance_percentage}%`;
      metricPending.textContent = Math.max(0, data.total_registered - data.total_checked_in);

      // Render recent checkins with live Undo capability
      if (data.recent_checkins && data.recent_checkins.length > 0) {
        feedContainer.innerHTML = data.recent_checkins.map(item => `
          <div class="checkin-feed-item">
            <div class="feed-item-left">
              <span class="feed-item-name">${escapeHtml(item.name)}</span>
              <span class="feed-item-meta">SAP: ${escapeHtml(item.sap_id)} • ${escapeHtml(item.program || '')} (${escapeHtml(item.branch || '')})</span>
              <span class="feed-item-meta" style="color: var(--accent-emerald); font-size: 0.74rem;">${escapeHtml(item.registration_id)} • ${escapeHtml(item.checked_in_at || 'Admitted')}</span>
            </div>
            <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
              <button type="button" class="btn-undo-checkin" data-reg-id="${escapeHtml(item.registration_id)}" title="Reset admission status">
                Undo
              </button>
            </div>
          </div>
        `).join('');

        // Attach undo checkin listeners
        feedContainer.querySelectorAll('.btn-undo-checkin').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const regId = e.currentTarget.getAttribute('data-reg-id');
            if (!confirm(`Reset check-in status for Pass ${regId}?`)) return;
            try {
              const res = await fetch('/api/volunteer/toggle-checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ registration_id: regId })
              });
              const d = await res.json();
              if (d.success) {
                fetchStats();
              } else {
                alert(d.message || 'Could not reset check-in status.');
              }
            } catch (err) {
              console.error('Error undoing checkin:', err);
            }
          });
        });
      } else {
        feedContainer.innerHTML = `
          <p style="color: var(--text-dim); font-size: 0.85rem; text-align: center; padding: 24px;">
            No check-ins recorded yet during this session.
          </p>
        `;
      }
    } catch (err) {
      console.warn('Failed to fetch stats:', err);
    }
  }

  // ── Camera Scanner Initialization via html5-qrcode ──
  let currentFacingMode = "environment";

  async function startCamera() {
    if (typeof Html5Qrcode === 'undefined') {
      cameraLabelText.textContent = 'Loading QR camera engine...';
      setTimeout(startCamera, 500);
      return;
    }

    try {
      if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("camera-viewport");
      }

      const config = {
        fps: 15,
        qrbox: { width: 240, height: 240 },
        aspectRatio: 1.0
      };

      const onScanSuccess = (decodedText) => {
        if (isScanningActive) {
          console.log("Scanned QR Code:", decodedText);
          verifyPass(decodedText);
        }
      };

      try {
        await html5QrCode.start({ facingMode: currentFacingMode }, config, onScanSuccess, () => {});
        cameraLabelText.textContent = `Camera active (${currentFacingMode === 'environment' ? 'Rear' : 'Front'}): Point at delegate pass`;
      } catch (err1) {
        // Try fallback to any available camera device
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          availableCameras = devices;
          await html5QrCode.start(devices[0].id, config, onScanSuccess, () => {});
          cameraLabelText.textContent = 'Camera active: Point at candidate pass';
        } else {
          cameraLabelText.textContent = 'Camera unavailable. Use manual entry or upload image.';
        }
      }
    } catch (err) {
      console.warn('Camera start issue:', err);
      cameraLabelText.textContent = 'Camera unavailable. Use manual entry or upload image.';
    }
  }

  // Flip Camera button
  btnToggleCamera.addEventListener('click', async () => {
    if (!html5QrCode) return;
    try {
      await html5QrCode.stop();
      currentFacingMode = (currentFacingMode === "environment") ? "user" : "environment";
      cameraLabelText.textContent = 'Switching camera...';
      const config = {
        fps: 15,
        qrbox: { width: 240, height: 240 },
        aspectRatio: 1.0
      };
      await html5QrCode.start(
        { facingMode: currentFacingMode },
        config,
        (decodedText) => {
          if (isScanningActive) verifyPass(decodedText);
        },
        () => {}
      );
      cameraLabelText.textContent = `Camera active (${currentFacingMode === 'environment' ? 'Rear' : 'Front'}): Point at pass`;
    } catch (err) {
      console.error('Camera flip error:', err);
      // Try device list switch
      try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 1) {
          currentCameraIndex = (currentCameraIndex + 1) % devices.length;
          await html5QrCode.start(devices[currentCameraIndex].id, { fps: 15, qrbox: { width: 240, height: 240 } }, (text) => { if (isScanningActive) verifyPass(text); }, () => {});
          cameraLabelText.textContent = `Camera active: ${devices[currentCameraIndex].label || 'Camera ' + (currentCameraIndex + 1)}`;
        }
      } catch (fallbackErr) {
        console.error('Fallback switch error:', fallbackErr);
      }
    }
  });

  // Image Upload / Photo Scan
  const qrFileInput = document.getElementById('qr-file-input');
  if (qrFileInput) {
    qrFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      cameraLabelText.textContent = 'Scanning QR image file...';
      try {
        if (!html5QrCode) {
          html5QrCode = new Html5Qrcode("camera-viewport");
        }
        const decodedText = await html5QrCode.scanFile(file, true);
        if (decodedText) {
          cameraLabelText.textContent = 'QR Code detected!';
          verifyPass(decodedText);
        } else {
          showResult('invalid', { message: 'No readable QR code found in uploaded image.' });
        }
      } catch (err) {
        console.warn('File scan error:', err);
        showResult('invalid', { message: 'Could not read QR code from this image. Please ensure the QR code is clearly visible.' });
      } finally {
        qrFileInput.value = '';
      }
    });
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

  // Initial load
  fetchStats();
  setInterval(fetchStats, 4000);

  // Slight delay before requesting camera permission to ensure DOM is ready
  setTimeout(startCamera, 800);
});
