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

      // Render recent checkins
      if (data.recent_checkins && data.recent_checkins.length > 0) {
        feedContainer.innerHTML = data.recent_checkins.map(item => `
          <div class="checkin-feed-item">
            <div class="feed-item-left">
              <span class="feed-item-name">${escapeHtml(item.name)}</span>
              <span class="feed-item-meta">SAP: ${escapeHtml(item.sap_id)} • ${escapeHtml(item.program || '')} (${escapeHtml(item.branch || '')})</span>
            </div>
            <div style="text-align: right;">
              <span class="feed-item-time">${escapeHtml(item.checked_in_at ? item.checked_in_at.split(' ')[3] + ' ' + (item.checked_in_at.split(' ')[4] || '') : 'Admitted')}</span>
              <div style="font-size: 0.72rem; color: var(--text-dim);">${escapeHtml(item.registration_id)}</div>
            </div>
          </div>
        `).join('');
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
  async function startCamera() {
    if (typeof Html5Qrcode === 'undefined') {
      cameraLabelText.textContent = 'Scanner library loading...';
      return;
    }

    try {
      html5QrCode = new Html5Qrcode("camera-viewport");

      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length) {
        availableCameras = devices;
        cameraLabelText.textContent = `Camera connected (${devices.length} available)`;

        // Prefer back camera ("environment")
        let preferredCameraId = devices[0].id;
        for (let dev of devices) {
          if (dev.label.toLowerCase().includes('back') || dev.label.toLowerCase().includes('rear') || dev.label.toLowerCase().includes('environment')) {
            preferredCameraId = dev.id;
            break;
          }
        }

        const config = {
          fps: 15,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.333
        };

        await html5QrCode.start(
          preferredCameraId,
          config,
          (decodedText) => {
            if (isScanningActive) {
              console.log("Scanned QR Code:", decodedText);
              verifyPass(decodedText);
            }
          },
          (errorMessage) => {
            // normal frame without QR code
          }
        );

        cameraLabelText.textContent = 'Scanner active: Point at candidate pass';
      } else {
        cameraLabelText.textContent = 'No camera found. Use manual entry below.';
      }
    } catch (err) {
      console.warn('Camera start issue:', err);
      cameraLabelText.textContent = 'Camera unavailable. Use manual entry below.';
    }
  }

  // Switch camera button
  btnToggleCamera.addEventListener('click', async () => {
    if (!html5QrCode || availableCameras.length < 2) {
      alert('Only one camera device detected on this system.');
      return;
    }
    try {
      await html5QrCode.stop();
      currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
      const nextCamera = availableCameras[currentCameraIndex];
      cameraLabelText.textContent = `Switched to: ${nextCamera.label || 'Camera ' + (currentCameraIndex + 1)}`;
      await html5QrCode.start(
        nextCamera.id,
        { fps: 15, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (isScanningActive) verifyPass(decodedText);
        },
        () => {}
      );
    } catch (err) {
      console.error('Camera switch error:', err);
    }
  });

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
