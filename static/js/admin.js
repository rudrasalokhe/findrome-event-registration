/**
 * Findrome NMIMS — Admin Console Controller
 * Multi-Event Isolated Database Manager & Attendee Roster
 */

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('admin-search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const tableBody = document.getElementById('candidates-table-body');
  const filterTabs = document.querySelectorAll('.filter-tab');

  // Metrics
  const metricTotal = document.getElementById('admin-metric-total');
  const metricAttended = document.getElementById('admin-metric-attended');
  const metricPending = document.getElementById('admin-metric-pending');
  const metricRate = document.getElementById('admin-metric-rate');
  const metricBtech = document.getElementById('admin-metric-btech');
  const metricMbatech = document.getElementById('admin-metric-mbatech');

  // Tab counters
  const countTabAll = document.getElementById('count-tab-all');
  const countTabAttended = document.getElementById('count-tab-attended');
  const countTabPending = document.getElementById('count-tab-pending');
  const countTabBtech = document.getElementById('count-tab-btech');
  const countTabMbatech = document.getElementById('count-tab-mbatech');

  // Event Switcher Controls
  const eventSelect = document.getElementById('admin-event-select');
  const activeLiveBadge = document.getElementById('active-live-badge');
  const btnMakeEventActive = document.getElementById('btn-make-event-active');
  const exportBtn = document.querySelector('a[href^="/admin/export"]');

  // Hero displays
  const adminHeroYear = document.getElementById('admin-hero-event-year');
  const adminEventNameDisplay = document.getElementById('admin-event-name-display');
  const adminHeaderDates = document.getElementById('admin-header-dates');

  let selectedEventCode = (eventSelect && eventSelect.value) || window.INITIAL_ACTIVE_EVENT || 'findrome_2026';
  let activeLiveCode = window.INITIAL_ACTIVE_EVENT || 'findrome_2026';
  let currentEventName = 'Findrome';
  let currentProgramFilter = 'ALL';
  let searchQuery = '';
  let searchDebounce = null;

  async function loadAdminData() {
    try {
      const url = `/api/admin/registrations?event_code=${encodeURIComponent(selectedEventCode)}&search=${encodeURIComponent(searchQuery)}&program=${encodeURIComponent(currentProgramFilter)}`;
      const res = await fetch(url);

      if (res.status === 403) {
        window.location.reload();
        return;
      }

      const data = await res.json();
      if (!data.success) return;

      currentEventName = `${data.event_name} ${data.event_edition}`.trim();

      // Update counters (isolated to this event's database collection!)
      const total = data.total || 0;
      const attended = data.checked_in || 0;
      const pending = data.pending !== undefined ? data.pending : Math.max(0, total - attended);
      const rate = data.attendance_percentage !== undefined ? data.attendance_percentage : (total > 0 ? Math.round((attended / total) * 100) : 0);
      const btech = data.btech_count || 0;
      const mbatech = (data.mbatech_count || 0) + (data.other_count || 0);

      if (metricTotal) metricTotal.textContent = total;
      if (metricAttended) metricAttended.textContent = attended;
      if (metricPending) metricPending.textContent = pending;
      if (metricRate) metricRate.textContent = `${rate}% Attendance Rate`;
      if (metricBtech) metricBtech.textContent = btech;
      if (metricMbatech) metricMbatech.textContent = mbatech;

      if (countTabAll) countTabAll.textContent = total;
      if (countTabAttended) countTabAttended.textContent = attended;
      if (countTabPending) countTabPending.textContent = pending;
      if (countTabBtech) countTabBtech.textContent = btech;
      if (countTabMbatech) countTabMbatech.textContent = mbatech;

      // Update header info
      if (adminHeroYear) adminHeroYear.textContent = currentEventName.toUpperCase();
      if (adminEventNameDisplay) adminEventNameDisplay.textContent = currentEventName;
      if (adminHeaderDates && data.event_dates) adminHeaderDates.textContent = data.event_dates;

      // Update export button link
      if (exportBtn) {
        exportBtn.href = `/admin/export?event_code=${encodeURIComponent(selectedEventCode)}`;
      }

      // Update Live vs Staged badge
      if (data.is_active) {
        if (activeLiveBadge) activeLiveBadge.style.display = 'inline-flex';
        if (btnMakeEventActive) btnMakeEventActive.style.display = 'none';
      } else {
        if (activeLiveBadge) activeLiveBadge.style.display = 'none';
        if (btnMakeEventActive) btnMakeEventActive.style.display = 'inline-flex';
      }

      renderTable(data.registrations);
    } catch (err) {
      console.error('Failed to load attendee roster:', err);
    }
  }

  function renderTable(list) {
    if (!list || list.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 48px 20px; color: var(--text-muted);">
            <div style="font-size: 1.05rem; font-weight: 600; color: #fff; margin-bottom: 6px;">
              No registrations found for ${escapeHtml(currentEventName)}
            </div>
            <div style="font-size: 0.82rem; color: var(--text-dim);">
              This event database is ready and will collect candidate entries when live.
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = list.map(item => {
      const isCheckedIn = (item.status === 'CHECKED_IN');
      const statusPill = isCheckedIn 
        ? `<span class="pass-status-pill admitted" style="font-size: 0.72rem; padding: 3px 8px;">✓ ADMITTED (SCANNED)</span>` 
        : `<span class="pass-status-pill confirmed" style="font-size: 0.72rem; opacity: 0.7; padding: 3px 8px;">PENDING SCAN</span>`;

      const timeDisplay = isCheckedIn && item.checked_in_at
        ? `<span style="font-size: 0.8rem; color: var(--emerald); font-family: var(--font-mono); font-weight: 600;">Scanned: ${escapeHtml(item.checked_in_at)}</span>`
        : `<span style="font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-mono);">Reg: ${escapeHtml(item.created_at || item.timestamp || '—')}</span>`;

      return `
        <tr>
          <td>
            <span class="reg-item-badge">${escapeHtml(item.registration_id)}</span>
          </td>
          <td>
            <div style="font-weight: 600; color: #fff;">${escapeHtml(item.name)}</div>
          </td>
          <td>
            ${statusPill}
          </td>
          <td>
            <code style="background: rgba(255,255,255,0.05); padding: 3px 8px; border-radius: 6px; font-size: 0.85rem; color: var(--emerald); font-weight: 600; font-family: var(--font-mono);">
              ${escapeHtml(item.sap_id)}
            </code>
          </td>
          <td>
            <span style="color: #f0f4f2; font-weight: 500;">${escapeHtml(item.program)}</span>
          </td>
          <td>
            <span style="color: var(--text-secondary); font-size: 0.84rem;">${escapeHtml(item.branch)} • ${escapeHtml(item.year_of_study)}</span>
          </td>
          <td>
            <a href="mailto:${escapeHtml(item.email)}" style="font-size: 0.84rem; color: #b4c2ba; text-decoration: none;">
              ${escapeHtml(item.email)}
            </a>
          </td>
          <td>
            <span style="font-size: 0.84rem; color: var(--text-dim); font-family: var(--font-mono);">
              ${escapeHtml(item.phone)}
            </span>
          </td>
          <td>
            ${timeDisplay}
          </td>
          <td style="text-align: right;">
            <button type="button" class="btn-secondary-dark btn-sm btn-admin-toggle-checkin" data-reg-id="${escapeHtml(item.registration_id)}" title="Toggle check-in status" style="padding: 4px 10px; font-size: 0.74rem;">
              ${isCheckedIn ? 'Undo Check-In' : 'Mark Scanned'}
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach toggle listeners
    tableBody.querySelectorAll('.btn-admin-toggle-checkin').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const regId = e.currentTarget.getAttribute('data-reg-id');
        btn.disabled = true;
        btn.textContent = '...';
        try {
          const res = await fetch('/api/admin/toggle-checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registration_id: regId })
          });
          const d = await res.json();
          if (d.success) {
            loadAdminData();
          } else {
            alert(d.message || 'Error updating status.');
            btn.disabled = false;
          }
        } catch (err) {
          alert('Network error.');
          btn.disabled = false;
        }
      });
    });
  }

  // Event Switcher dropdown listener
  if (eventSelect) {
    eventSelect.addEventListener('change', () => {
      selectedEventCode = eventSelect.value;
      loadAdminData();
      preloadEventSettings(selectedEventCode);
    });
  }

  // "Set as Live Event" button
  if (btnMakeEventActive) {
    btnMakeEventActive.addEventListener('click', async () => {
      btnMakeEventActive.disabled = true;
      btnMakeEventActive.textContent = 'Switching...';
      try {
        const res = await fetch('/api/admin/switch-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_code: selectedEventCode })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          activeLiveCode = selectedEventCode;
          Array.from(eventSelect.options).forEach(opt => {
            if (opt.value === activeLiveCode) {
              if (!opt.textContent.includes('Live')) opt.textContent += ' ● (Live Active Form)';
            } else {
              opt.textContent = opt.textContent.replace(' ● (Live Active Form)', '');
            }
          });
          loadAdminData();
        }
      } catch (err) {
        console.error('Error switching event:', err);
      } finally {
        btnMakeEventActive.disabled = false;
        btnMakeEventActive.textContent = 'Set as Live Event';
      }
    });
  }

  // Search input with debounce
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      btnClearSearch.style.display = searchQuery ? 'inline-block' : 'none';

      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        loadAdminData();
      }, 250);
    });
  }

  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.style.display = 'none';
      loadAdminData();
    });
  }

  // Filter tabs
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentProgramFilter = tab.getAttribute('data-program');
      loadAdminData();
    });
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

  // ── Preload Event Settings for Edit Modal ──
  async function preloadEventSettings(code) {
    try {
      const res = await fetch(`/api/event-config?event_code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (res.ok && data.success && data.settings) {
        const s = data.settings;
        if (document.getElementById('cfg-event-code')) document.getElementById('cfg-event-code').value = s.event_code || code;
        if (cfgEventName) cfgEventName.value = s.event_name || '';
        if (cfgEventEdition) cfgEventEdition.value = s.event_edition || '';
        if (cfgStartDate) cfgStartDate.value = s.event_start_date || '';
        if (cfgEndDate) cfgEndDate.value = s.event_end_date || '';
        if (cfgEventDates) cfgEventDates.value = s.event_dates || '';
        if (cfgEventVenue) cfgEventVenue.value = s.event_venue || '';
      }
    } catch (e) {}
  }

  // ── Event Schedule Edit Modal Controller ──
  const eventSettingsModal = document.getElementById('event-settings-modal');
  const btnOpenSettings = document.getElementById('btn-open-event-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnCancelSettings = document.getElementById('btn-cancel-settings');
  const eventSettingsForm = document.getElementById('event-settings-form');
  const saveAlert = document.getElementById('settings-save-alert');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  const cfgEventCode = document.getElementById('cfg-event-code');
  const cfgEventName = document.getElementById('cfg-event-name');
  const cfgEventEdition = document.getElementById('cfg-event-edition');
  const cfgStartDate = document.getElementById('cfg-start-date');
  const cfgEndDate = document.getElementById('cfg-end-date');
  const cfgEventDates = document.getElementById('cfg-event-dates');
  const cfgEventVenue = document.getElementById('cfg-event-venue');

  if (btnOpenSettings && eventSettingsModal) {
    btnOpenSettings.addEventListener('click', () => {
      if (saveAlert) saveAlert.style.display = 'none';
      preloadEventSettings(selectedEventCode);
      eventSettingsModal.classList.add('active');
    });

    const closeModal = () => eventSettingsModal.classList.remove('active');
    if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeModal);
    if (btnCancelSettings) btnCancelSettings.addEventListener('click', closeModal);

    eventSettingsModal.addEventListener('click', (e) => {
      if (e.target === eventSettingsModal) closeModal();
    });

    const updateAutoDates = () => {
      if (!cfgStartDate.value) return;
      try {
        const d1 = new Date(cfgStartDate.value + 'T00:00:00');
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        if (cfgEndDate.value && cfgEndDate.value !== cfgStartDate.value) {
          const d2 = new Date(cfgEndDate.value + 'T00:00:00');
          if (d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()) {
            cfgEventDates.value = `${months[d1.getMonth()]} ${d1.getDate()} – ${d2.getDate()}, ${d1.getFullYear()}`;
          } else {
            cfgEventDates.value = `${months[d1.getMonth()]} ${d1.getDate()}, ${d1.getFullYear()} – ${months[d2.getMonth()]} ${d2.getDate()}, ${d2.getFullYear()}`;
          }
        } else {
          cfgEventDates.value = `${months[d1.getMonth()]} ${d1.getDate()}, ${d1.getFullYear()}`;
        }
      } catch (err) {}
    };

    cfgStartDate.addEventListener('change', updateAutoDates);
    cfgEndDate.addEventListener('change', updateAutoDates);

    eventSettingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      btnSaveSettings.disabled = true;
      btnSaveSettings.textContent = 'Saving to MongoDB...';
      if (saveAlert) saveAlert.style.display = 'none';

      const payload = {
        event_code: (cfgEventCode && cfgEventCode.value) || selectedEventCode,
        event_name: cfgEventName.value.trim(),
        event_edition: cfgEventEdition.value.trim(),
        event_dates: cfgEventDates.value.trim(),
        event_start_date: cfgStartDate.value,
        event_end_date: cfgEndDate.value,
        event_venue: cfgEventVenue.value.trim()
      };

      try {
        const res = await fetch('/api/admin/event-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok && data.success) {
          saveAlert.style.display = 'block';
          saveAlert.style.background = 'rgba(0, 223, 130, 0.1)';
          saveAlert.style.border = '1px solid rgba(0, 223, 130, 0.3)';
          saveAlert.style.color = '#00df82';
          saveAlert.textContent = 'Event schedule updated in MongoDB Atlas!';

          loadAdminData();

          setTimeout(() => {
            closeModal();
            btnSaveSettings.disabled = false;
            btnSaveSettings.textContent = 'Save Event Schedule';
          }, 1000);
        } else {
          saveAlert.style.display = 'block';
          saveAlert.style.background = 'rgba(255, 82, 82, 0.1)';
          saveAlert.style.border = '1px solid rgba(255, 82, 82, 0.3)';
          saveAlert.style.color = '#ff8080';
          saveAlert.textContent = data.message || 'Failed to save settings.';
          btnSaveSettings.disabled = false;
          btnSaveSettings.textContent = 'Save Event Schedule';
        }
      } catch (err) {
        saveAlert.style.display = 'block';
        saveAlert.style.background = 'rgba(255, 82, 82, 0.1)';
        saveAlert.style.border = '1px solid rgba(255, 82, 82, 0.3)';
        saveAlert.style.color = '#ff8080';
        saveAlert.textContent = 'Network error saving settings.';
        btnSaveSettings.disabled = false;
        btnSaveSettings.textContent = 'Save Event Schedule';
      }
    });
  }

  // ── Create New Event Modal Controller ──
  const newEventModal = document.getElementById('new-event-modal');
  const btnOpenNewEvent = document.getElementById('btn-open-new-event-modal');
  const btnCloseNewEvent = document.getElementById('btn-close-new-event');
  const btnCancelNewEvent = document.getElementById('btn-cancel-new-event');
  const createNewEventForm = document.getElementById('create-new-event-form');
  const newEventAlert = document.getElementById('new-event-alert');
  const btnSubmitNewEvent = document.getElementById('btn-submit-new-event');

  const newEventName = document.getElementById('new-event-name');
  const newEventEdition = document.getElementById('new-event-edition');
  const newStartDate = document.getElementById('new-start-date');
  const newEndDate = document.getElementById('new-end-date');
  const newEventDates = document.getElementById('new-event-dates');
  const newEventVenue = document.getElementById('new-event-venue');
  const newMakeActive = document.getElementById('new-make-active');

  if (btnOpenNewEvent && newEventModal) {
    btnOpenNewEvent.addEventListener('click', () => {
      if (newEventAlert) newEventAlert.style.display = 'none';
      createNewEventForm.reset();
      newEventModal.classList.add('active');
    });

    const closeNewModal = () => newEventModal.classList.remove('active');
    if (btnCloseNewEvent) btnCloseNewEvent.addEventListener('click', closeNewModal);
    if (btnCancelNewEvent) btnCancelNewEvent.addEventListener('click', closeNewModal);

    newEventModal.addEventListener('click', (e) => {
      if (e.target === newEventModal) closeNewModal();
    });

    const updateNewAutoDates = () => {
      if (!newStartDate.value) return;
      try {
        const d1 = new Date(newStartDate.value + 'T00:00:00');
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        if (newEndDate.value && newEndDate.value !== newStartDate.value) {
          const d2 = new Date(newEndDate.value + 'T00:00:00');
          if (d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()) {
            newEventDates.value = `${months[d1.getMonth()]} ${d1.getDate()} – ${d2.getDate()}, ${d1.getFullYear()}`;
          } else {
            newEventDates.value = `${months[d1.getMonth()]} ${d1.getDate()}, ${d1.getFullYear()} – ${months[d2.getMonth()]} ${d2.getDate()}, ${d2.getFullYear()}`;
          }
        } else {
          newEventDates.value = `${months[d1.getMonth()]} ${d1.getDate()}, ${d1.getFullYear()}`;
        }
      } catch (err) {}
    };

    if (newStartDate) newStartDate.addEventListener('change', updateNewAutoDates);
    if (newEndDate) newEndDate.addEventListener('change', updateNewAutoDates);

    if (createNewEventForm) {
      createNewEventForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        btnSubmitNewEvent.disabled = true;
        btnSubmitNewEvent.textContent = 'Spinning up Database in Atlas...';
        if (newEventAlert) newEventAlert.style.display = 'none';

        const payload = {
          event_name: newEventName.value.trim(),
          event_edition: newEventEdition.value.trim(),
          event_dates: newEventDates.value.trim(),
          event_start_date: newStartDate.value,
          event_end_date: newEndDate.value,
          event_venue: newEventVenue.value.trim(),
          is_active: newMakeActive ? newMakeActive.checked : true
        };

        try {
          const res = await fetch('/api/admin/create-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const data = await res.json();
          if (res.ok && data.success) {
            newEventAlert.style.display = 'block';
            newEventAlert.style.background = 'rgba(0, 223, 130, 0.1)';
            newEventAlert.style.border = '1px solid rgba(0, 223, 130, 0.3)';
            newEventAlert.style.color = '#00df82';
            newEventAlert.textContent = data.message;

            // Add the new option to the dropdown
            const newOpt = document.createElement('option');
            newOpt.value = data.event_code;
            newOpt.textContent = `${payload.event_name} ${payload.event_edition}${data.is_active ? ' ● (Live Active Form)' : ''}`;
            
            if (data.is_active) {
              activeLiveCode = data.event_code;
              Array.from(eventSelect.options).forEach(opt => {
                opt.textContent = opt.textContent.replace(' ● (Live Active Form)', '');
              });
            }

            eventSelect.appendChild(newOpt);
            eventSelect.value = data.event_code;
            selectedEventCode = data.event_code;

            // Immediately reload admin data -> Starts fresh at 0 registrations!
            loadAdminData();

            setTimeout(() => {
              closeNewModal();
              btnSubmitNewEvent.disabled = false;
              btnSubmitNewEvent.textContent = 'Create & Launch Event';
            }, 1000);
          } else {
            newEventAlert.style.display = 'block';
            newEventAlert.style.background = 'rgba(255, 82, 82, 0.1)';
            newEventAlert.style.border = '1px solid rgba(255, 82, 82, 0.3)';
            newEventAlert.style.color = '#ff8080';
            newEventAlert.textContent = data.message || 'Failed to create event.';
            btnSubmitNewEvent.disabled = false;
            btnSubmitNewEvent.textContent = 'Create & Launch Event';
          }
        } catch (err) {
          newEventAlert.style.display = 'block';
          newEventAlert.style.background = 'rgba(255, 82, 82, 0.1)';
          newEventAlert.style.border = '1px solid rgba(255, 82, 82, 0.3)';
          newEventAlert.style.color = '#ff8080';
          newEventAlert.textContent = 'Network error creating event.';
          btnSubmitNewEvent.disabled = false;
          btnSubmitNewEvent.textContent = 'Create & Launch Event';
        }
      });
    }
  }

  // Initial load
  loadAdminData();
});
