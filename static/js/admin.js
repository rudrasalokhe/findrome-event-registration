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

      // Update Reminder Modal badge counts
      const reminderCountAllBadge = document.getElementById('reminder-count-all-badge');
      const reminderCountPendingBadge = document.getElementById('reminder-count-pending-badge');
      if (reminderCountAllBadge) reminderCountAllBadge.textContent = `${total} attendee${total === 1 ? '' : 's'}`;
      if (reminderCountPendingBadge) reminderCountPendingBadge.textContent = `${pending} attendee${pending === 1 ? '' : 's'}`;

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
          <td colspan="11" style="text-align: center; padding: 48px 20px; color: var(--text-muted);">
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

      const collegeBadge = item.college
        ? `<span style="display: inline-block; background: rgba(0, 223, 130, 0.08); border: 1px solid rgba(0, 223, 130, 0.25); color: #00df82; padding: 2px 7px; border-radius: 6px; font-size: 0.76rem; font-weight: 600;">${escapeHtml(item.college)}</span>`
        : `<span style="color: var(--text-dim); font-size: 0.8rem;">—</span>`;

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
            ${collegeBadge}
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
            ${item.reminder_sent_at ? `
              <div style="font-size: 0.72rem; color: var(--emerald); margin-top: 3px; display: flex; align-items: center; gap: 4px;" title="Reminder sent: ${escapeHtml(item.reminder_sent_at)}">
                <span>✉️</span>
                <span>Sent (${item.reminder_count || 1}x)</span>
              </div>
            ` : ''}
          </td>
          <td>
            <span style="font-size: 0.84rem; color: var(--text-dim); font-family: var(--font-mono);">
              ${escapeHtml(item.phone)}
            </span>
          </td>
          <td>
            ${timeDisplay}
          </td>
          <td style="text-align: right; white-space: nowrap;">
            <div style="display: inline-flex; gap: 6px;">
              <button type="button" class="btn-secondary-dark btn-sm btn-admin-row-remind" data-reg-id="${escapeHtml(item.registration_id)}" data-name="${escapeHtml(item.name)}" data-email="${escapeHtml(item.email)}" title="Send reminder email to ${escapeHtml(item.name)}" style="padding: 4px 8px; font-size: 0.74rem;">
                ✉️ Remind
              </button>
              <button type="button" class="btn-secondary-dark btn-sm btn-admin-toggle-checkin" data-reg-id="${escapeHtml(item.registration_id)}" title="Toggle check-in status" style="padding: 4px 10px; font-size: 0.74rem;">
                ${isCheckedIn ? 'Undo Check-In' : 'Mark Scanned'}
              </button>
            </div>
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

    // Attach row reminder listeners
    tableBody.querySelectorAll('.btn-admin-row-remind').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const regId = e.currentTarget.getAttribute('data-reg-id');
        const name = e.currentTarget.getAttribute('data-name');
        const email = e.currentTarget.getAttribute('data-email');
        openReminderModalForSingle(regId, name, email);
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

  // ── Delete Event Modal Controller ──
  const deleteEventModal = document.getElementById('delete-event-modal');
  const btnOpenDeleteModal = document.getElementById('btn-open-delete-modal');
  const btnCloseDeleteModal = document.getElementById('btn-close-delete-modal');
  const btnCancelDeleteEvent = document.getElementById('btn-cancel-delete-event');
  const btnConfirmDeleteEvent = document.getElementById('btn-confirm-delete-event');

  const deleteEventNameTarget = document.getElementById('delete-event-name-target');
  const deleteEventAttendeesCount = document.getElementById('delete-event-attendees-count');
  const deleteEventColName = document.getElementById('delete-event-col-name');
  const deleteEventGuardrailWarning = document.getElementById('delete-event-guardrail-warning');
  const deleteEventAlert = document.getElementById('delete-event-alert');

  if (btnOpenDeleteModal && deleteEventModal) {
    btnOpenDeleteModal.addEventListener('click', () => {
      if (deleteEventAlert) deleteEventAlert.style.display = 'none';
      if (deleteEventGuardrailWarning) deleteEventGuardrailWarning.style.display = 'none';

      const eventName = currentEventName || selectedEventCode;
      if (deleteEventNameTarget) deleteEventNameTarget.textContent = eventName;
      
      const totalAttendees = (metricTotal && metricTotal.textContent) ? metricTotal.textContent : '0';
      if (deleteEventAttendeesCount) deleteEventAttendeesCount.textContent = totalAttendees;

      const colName = (selectedEventCode === 'findrome_2026') ? 'registrations' : `registrations_${selectedEventCode}`;
      if (deleteEventColName) deleteEventColName.textContent = colName;

      // Check guardrails:
      // 1. Is it the active live event?
      const isLiveActive = (selectedEventCode === activeLiveCode);
      // 2. Is it the only remaining event?
      const isOnlyEvent = (eventSelect && eventSelect.options.length <= 1);

      if (isLiveActive) {
        deleteEventGuardrailWarning.textContent = '⚠️ This event is currently set as the LIVE public form. Please set another event as the live form before deleting this event.';
        deleteEventGuardrailWarning.style.display = 'block';
        if (btnConfirmDeleteEvent) {
          btnConfirmDeleteEvent.disabled = true;
          btnConfirmDeleteEvent.title = 'Cannot delete active live event';
        }
      } else if (isOnlyEvent) {
        deleteEventGuardrailWarning.textContent = '⚠️ Cannot delete the only remaining event in the database.';
        deleteEventGuardrailWarning.style.display = 'block';
        if (btnConfirmDeleteEvent) {
          btnConfirmDeleteEvent.disabled = true;
          btnConfirmDeleteEvent.title = 'Cannot delete sole remaining event';
        }
      } else {
        if (btnConfirmDeleteEvent) {
          btnConfirmDeleteEvent.disabled = false;
          btnConfirmDeleteEvent.title = 'Permanently delete this event';
          btnConfirmDeleteEvent.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Permanently Delete</span>
          `;
        }
      }

      deleteEventModal.classList.add('active');
    });

    const closeDeleteModal = () => deleteEventModal.classList.remove('active');
    if (btnCloseDeleteModal) btnCloseDeleteModal.addEventListener('click', closeDeleteModal);
    if (btnCancelDeleteEvent) btnCancelDeleteEvent.addEventListener('click', closeDeleteModal);

    deleteEventModal.addEventListener('click', (e) => {
      if (e.target === deleteEventModal) closeDeleteModal();
    });

    if (btnConfirmDeleteEvent) {
      btnConfirmDeleteEvent.addEventListener('click', async () => {
        btnConfirmDeleteEvent.disabled = true;
        btnConfirmDeleteEvent.textContent = 'Deleting from MongoDB Atlas...';
        if (deleteEventAlert) deleteEventAlert.style.display = 'none';

        try {
          const res = await fetch('/api/admin/delete-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_code: selectedEventCode })
          });

          const data = await res.json();
          if (res.ok && data.success) {
            deleteEventAlert.style.display = 'block';
            deleteEventAlert.style.background = 'rgba(0, 223, 130, 0.1)';
            deleteEventAlert.style.border = '1px solid rgba(0, 223, 130, 0.3)';
            deleteEventAlert.style.color = '#00df82';
            deleteEventAlert.textContent = data.message;

            // Remove option from dropdown
            const optToRemove = eventSelect ? eventSelect.querySelector(`option[value="${selectedEventCode}"]`) : null;
            if (optToRemove) optToRemove.remove();

            // Switch selectedEventCode to active live code or first available
            if (eventSelect && eventSelect.options.length > 0) {
              const liveOpt = eventSelect.querySelector(`option[value="${activeLiveCode}"]`);
              if (liveOpt) {
                eventSelect.value = activeLiveCode;
                selectedEventCode = activeLiveCode;
              } else {
                eventSelect.selectedIndex = 0;
                selectedEventCode = eventSelect.value;
              }
            }

            // Reload admin data for the newly selected event
            loadAdminData();

            setTimeout(() => {
              closeDeleteModal();
              btnConfirmDeleteEvent.disabled = false;
              btnConfirmDeleteEvent.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span>Permanently Delete</span>
              `;
            }, 900);
          } else {
            deleteEventAlert.style.display = 'block';
            deleteEventAlert.style.background = 'rgba(255, 82, 82, 0.1)';
            deleteEventAlert.style.border = '1px solid rgba(255, 82, 82, 0.3)';
            deleteEventAlert.style.color = '#ff8080';
            deleteEventAlert.textContent = data.message || 'Failed to delete event.';
            btnConfirmDeleteEvent.disabled = false;
            btnConfirmDeleteEvent.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              <span>Permanently Delete</span>
            `;
          }
        } catch (err) {
          deleteEventAlert.style.display = 'block';
          deleteEventAlert.style.background = 'rgba(255, 82, 82, 0.1)';
          deleteEventAlert.style.border = '1px solid rgba(255, 82, 82, 0.3)';
          deleteEventAlert.style.color = '#ff8080';
          deleteEventAlert.textContent = 'Network error deleting event.';
          btnConfirmDeleteEvent.disabled = false;
          btnConfirmDeleteEvent.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Permanently Delete</span>
          `;
        }
      });
    }
  }

  // ── Send Reminder Modal Controller ──
  const sendReminderModal = document.getElementById('send-reminder-modal');
  const btnOpenSendReminder = document.getElementById('btn-open-send-reminder');
  const btnCloseReminderModal = document.getElementById('btn-close-reminder-modal');
  const btnCancelReminder = document.getElementById('btn-cancel-reminder');
  const sendReminderForm = document.getElementById('send-reminder-form');
  const reminderSubjectInput = document.getElementById('reminder-subject-input');
  const reminderCustomMessage = document.getElementById('reminder-custom-message');
  const reminderStatusAlert = document.getElementById('reminder-status-alert');
  const btnSubmitSendReminder = document.getElementById('btn-submit-send-reminder');
  const btnSubmitSendReminderText = document.getElementById('btn-submit-send-reminder-text');
  const smtpStatusText = document.getElementById('smtp-status-text');
  const btnSendAdminTestEmail = document.getElementById('btn-send-admin-test-email');

  const reminderTargetOptions = document.getElementById('reminder-target-options');
  const targetLabelAll = document.getElementById('target-label-all');
  const targetLabelPending = document.getElementById('target-label-pending');
  const reminderSingleAttendeeCard = document.getElementById('reminder-single-attendee-card');
  const reminderSingleName = document.getElementById('reminder-single-name');
  const reminderSingleMeta = document.getElementById('reminder-single-meta');
  const reminderSingleRegId = document.getElementById('reminder-single-reg-id');
  const btnReminderSwitchToAll = document.getElementById('btn-reminder-switch-to-all');

  const btnToggleEmailPreview = document.getElementById('btn-toggle-email-preview');
  const emailPreviewContainer = document.getElementById('email-preview-container');
  const previewToggleIcon = document.getElementById('preview-toggle-icon');

  function updateTargetRadioStyles() {
    const checked = document.querySelector('input[name="reminder-target"]:checked');
    if (!checked) return;
    if (checked.value === 'all') {
      if (targetLabelAll) {
        targetLabelAll.style.background = 'rgba(0, 223, 130, 0.08)';
        targetLabelAll.style.borderColor = 'rgba(0, 223, 130, 0.35)';
      }
      if (targetLabelPending) {
        targetLabelPending.style.background = 'rgba(255, 255, 255, 0.02)';
        targetLabelPending.style.borderColor = 'var(--border-default)';
      }
    } else {
      if (targetLabelPending) {
        targetLabelPending.style.background = 'rgba(251, 191, 36, 0.08)';
        targetLabelPending.style.borderColor = 'rgba(251, 191, 36, 0.35)';
      }
      if (targetLabelAll) {
        targetLabelAll.style.background = 'rgba(255, 255, 255, 0.02)';
        targetLabelAll.style.borderColor = 'var(--border-default)';
      }
    }
  }

  document.querySelectorAll('input[name="reminder-target"]').forEach(r => {
    r.addEventListener('change', updateTargetRadioStyles);
  });

  async function checkSmtpStatus() {
    try {
      const res = await fetch('/api/admin/smtp-status');
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.is_configured) {
          if (smtpStatusText) {
            smtpStatusText.innerHTML = `<span style="color: #00df82; font-weight: 600;">● SMTP Active</span> (${escapeHtml(data.server)}:${data.port}) — Real Emails`;
          }
        } else {
          if (smtpStatusText) {
            smtpStatusText.innerHTML = `<span style="color: #fbbf24; font-weight: 600;">● Simulated Test Mode</span> (Add SMTP to .env for live emails)`;
          }
        }
      }
    } catch (e) {
      if (smtpStatusText) smtpStatusText.textContent = 'Mail server status unavailable';
    }
  }

  function renderEmailPreview() {
    if (!emailPreviewContainer) return;
    const subj = (reminderSubjectInput && reminderSubjectInput.value.trim()) || `⏰ Event Reminder: ${currentEventName} is coming up!`;
    const customMsg = (reminderCustomMessage && reminderCustomMessage.value.trim()) || '';
    const dates = (adminHeaderDates && adminHeaderDates.textContent) || 'September 28 – 29, 2026';

    emailPreviewContainer.innerHTML = `
      <div style="border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px; margin-bottom: 8px;">
        <span style="color: var(--text-dim);">Subject:</span>
        <strong style="color: #fff; margin-left: 4px;">${escapeHtml(subj)}</strong>
      </div>
      <div style="background: rgba(0, 223, 130, 0.1); border-left: 3px solid #00df82; padding: 6px 10px; margin-bottom: 8px; border-radius: 3px;">
        <strong style="color: var(--emerald);">⏰ EVENT REMINDER NOTICE: ${escapeHtml(currentEventName)}</strong> • ${escapeHtml(dates)}
      </div>
      <div style="margin-bottom: 6px;">Hello <span style="color: #fff; font-weight: 600;">Candidate Name</span>,</div>
      <div style="color: #a4b8ad; margin-bottom: 8px;">This is a reminder that you are registered for ${escapeHtml(currentEventName)}. Here is a reminder of your event details:</div>
      ${customMsg ? `<div style="background: rgba(0, 223, 130, 0.06); border-left: 2px solid var(--emerald); padding: 6px 8px; margin-bottom: 8px; color: #d6f5e6;">📢 ${escapeHtml(customMsg)}</div>` : ''}
      <div style="background: #111a15; border: 1px dashed rgba(0,223,130,0.3); padding: 8px; border-radius: 4px; font-family: monospace; font-size: 0.72rem; color: #fff;">
        <div style="color: var(--emerald); font-weight: 700;">YOUR REGISTERED PASS: FD-SAMPLE-2026</div>
        <div>Dates: ${escapeHtml(dates)}</div>
        <div>Checklist: Carry college ID, be there at the registration desk by 1:30 PM for smooth entry</div>
      </div>
    `;
  }

  function openReminderModal() {
    if (reminderStatusAlert) reminderStatusAlert.style.display = 'none';
    if (reminderSubjectInput) {
      reminderSubjectInput.value = `⏰ Event Reminder: ${currentEventName} is coming up!`;
    }
    if (reminderSingleAttendeeCard) reminderSingleAttendeeCard.style.display = 'none';
    if (reminderTargetOptions) reminderTargetOptions.style.display = 'grid';
    if (reminderSingleRegId) reminderSingleRegId.value = '';
    
    // Default to 'all'
    const allRadio = document.querySelector('input[name="reminder-target"][value="all"]');
    if (allRadio) allRadio.checked = true;
    updateTargetRadioStyles();

    checkSmtpStatus();
    renderEmailPreview();
    if (sendReminderModal) sendReminderModal.classList.add('active');
  }

  function openReminderModalForSingle(regId, name, email) {
    if (reminderStatusAlert) reminderStatusAlert.style.display = 'none';
    if (reminderSubjectInput) {
      reminderSubjectInput.value = `⏰ Event Reminder: ${currentEventName} is coming up!`;
    }
    if (reminderSingleRegId) reminderSingleRegId.value = regId;
    if (reminderSingleName) reminderSingleName.textContent = name || 'Attendee';
    if (reminderSingleMeta) reminderSingleMeta.textContent = `Pass ID: ${regId} • ${email || 'No email'}`;
    
    if (reminderSingleAttendeeCard) reminderSingleAttendeeCard.style.display = 'block';
    if (reminderTargetOptions) reminderTargetOptions.style.display = 'none';

    checkSmtpStatus();
    renderEmailPreview();
    if (sendReminderModal) sendReminderModal.classList.add('active');
  }

  const closeReminderModal = () => {
    if (sendReminderModal) sendReminderModal.classList.remove('active');
  };

  if (btnOpenSendReminder) btnOpenSendReminder.addEventListener('click', openReminderModal);
  if (btnCloseReminderModal) btnCloseReminderModal.addEventListener('click', closeReminderModal);
  if (btnCancelReminder) btnCancelReminder.addEventListener('click', closeReminderModal);

  if (sendReminderModal) {
    sendReminderModal.addEventListener('click', (e) => {
      if (e.target === sendReminderModal) closeReminderModal();
    });
  }

  if (btnReminderSwitchToAll) {
    btnReminderSwitchToAll.addEventListener('click', () => {
      if (reminderSingleAttendeeCard) reminderSingleAttendeeCard.style.display = 'none';
      if (reminderTargetOptions) reminderTargetOptions.style.display = 'grid';
      if (reminderSingleRegId) reminderSingleRegId.value = '';
    });
  }

  if (btnToggleEmailPreview && emailPreviewContainer) {
    btnToggleEmailPreview.addEventListener('click', () => {
      const isVisible = (emailPreviewContainer.style.display !== 'none');
      emailPreviewContainer.style.display = isVisible ? 'none' : 'block';
      if (previewToggleIcon) previewToggleIcon.textContent = isVisible ? '▼' : '▲';
      if (!isVisible) renderEmailPreview();
    });
  }

  if (reminderSubjectInput) reminderSubjectInput.addEventListener('input', renderEmailPreview);
  if (reminderCustomMessage) reminderCustomMessage.addEventListener('input', renderEmailPreview);

  // Test Email to Admin Button
  if (btnSendAdminTestEmail) {
    btnSendAdminTestEmail.addEventListener('click', async () => {
      const testEmail = prompt('Enter your email address to receive a sample reminder email:', '');
      if (!testEmail || !testEmail.trim()) return;

      btnSendAdminTestEmail.disabled = true;
      btnSendAdminTestEmail.textContent = 'Sending...';

      try {
        const res = await fetch('/api/admin/send-reminder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_code: selectedEventCode,
            test_email: testEmail.trim(),
            subject: (reminderSubjectInput && reminderSubjectInput.value.trim()) || `Reminder: ${currentEventName}`,
            custom_message: (reminderCustomMessage && reminderCustomMessage.value.trim()) || ''
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          alert(`✓ ${data.message}`);
        } else {
          alert(`Error: ${data.message || 'Failed to dispatch test email.'}`);
        }
      } catch (err) {
        alert('Network error attempting test dispatch.');
      } finally {
        btnSendAdminTestEmail.disabled = false;
        btnSendAdminTestEmail.textContent = 'Send Test to Me';
      }
    });
  }

  // Form submit: send reminders
  if (sendReminderForm) {
    sendReminderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      btnSubmitSendReminder.disabled = true;
      btnSubmitSendReminderText.textContent = 'Dispatching Emails...';
      if (reminderStatusAlert) reminderStatusAlert.style.display = 'none';

      let target = 'all';
      let singleRegId = '';

      if (reminderSingleRegId && reminderSingleRegId.value) {
        target = 'single';
        singleRegId = reminderSingleRegId.value;
      } else {
        const checkedRadio = document.querySelector('input[name="reminder-target"]:checked');
        if (checkedRadio) target = checkedRadio.value;
      }

      const payload = {
        event_code: selectedEventCode,
        target: target,
        registration_id: singleRegId,
        subject: (reminderSubjectInput && reminderSubjectInput.value.trim()) || '',
        custom_message: (reminderCustomMessage && reminderCustomMessage.value.trim()) || ''
      };

      try {
        const res = await fetch('/api/admin/send-reminder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok && data.success) {
          if (data.async && data.job_id) {
            // Live background progress polling for 200+ attendees
            reminderStatusAlert.style.display = 'block';
            reminderStatusAlert.style.background = 'rgba(0, 223, 130, 0.08)';
            reminderStatusAlert.style.border = '1px solid rgba(0, 223, 130, 0.3)';
            reminderStatusAlert.style.color = '#d6f5e6';
            reminderStatusAlert.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <strong>🔄 Sending in background...</strong>
                <span id="rem-progress-pct" style="font-weight: 700; color: var(--emerald);">0%</span>
              </div>
              <div style="background: rgba(255,255,255,0.06); height: 6px; border-radius: 3px; overflow: hidden; margin-bottom: 6px;">
                <div id="rem-progress-bar" style="background: var(--emerald); width: 0%; height: 100%; transition: width 0.3s ease;"></div>
              </div>
              <div style="font-size: 0.74rem; color: var(--text-dim);" id="rem-progress-text">
                Sent 0 / ${data.total_target} emails... You can close this modal or wait.
              </div>
            `;

            const pollInterval = setInterval(async () => {
              try {
                const jRes = await fetch(`/api/admin/reminder-job/${data.job_id}`);
                const jData = await jRes.json();
                if (jRes.ok && jData.success && jData.job) {
                  const job = jData.job;
                  const total = job.total_target || 1;
                  const done = (job.sent_count || 0) + (job.failed_count || 0);
                  const pct = Math.min(100, Math.round((done / total) * 100));

                  const bar = document.getElementById('rem-progress-bar');
                  const pctText = document.getElementById('rem-progress-pct');
                  const desc = document.getElementById('rem-progress-text');
                  if (bar) bar.style.width = `${pct}%`;
                  if (pctText) pctText.textContent = `${pct}%`;
                  if (desc) desc.textContent = `Sent ${job.sent_count} / ${total} emails (${job.failed_count} failed)...`;

                  if (job.status === 'completed') {
                    clearInterval(pollInterval);
                    reminderStatusAlert.style.background = 'rgba(0, 223, 130, 0.15)';
                    reminderStatusAlert.innerHTML = `<strong>✓ Complete:</strong> Dispatched ${job.sent_count} reminder emails to attendees!`;
                    loadAdminData();
                    setTimeout(() => {
                      closeReminderModal();
                      btnSubmitSendReminder.disabled = false;
                      btnSubmitSendReminderText.textContent = 'Send Reminder Emails';
                    }, 2200);
                  }
                }
              } catch (e) {
                // network blip during polling, will retry next tick
              }
            }, 1200);

            return;
          }

          reminderStatusAlert.style.display = 'block';
          reminderStatusAlert.style.background = 'rgba(0, 223, 130, 0.1)';
          reminderStatusAlert.style.border = '1px solid rgba(0, 223, 130, 0.3)';
          reminderStatusAlert.style.color = '#00df82';
          reminderStatusAlert.innerHTML = `<strong>✓ Success:</strong> ${escapeHtml(data.message)}`;

          // Refresh admin data so updated reminder timestamps appear immediately!
          loadAdminData();

          setTimeout(() => {
            closeReminderModal();
            btnSubmitSendReminder.disabled = false;
            btnSubmitSendReminderText.textContent = 'Send Reminder Emails';
          }, 1800);
        } else {
          reminderStatusAlert.style.display = 'block';
          reminderStatusAlert.style.background = 'rgba(255, 82, 82, 0.1)';
          reminderStatusAlert.style.border = '1px solid rgba(255, 82, 82, 0.3)';
          reminderStatusAlert.style.color = '#ff8080';
          reminderStatusAlert.textContent = data.message || 'Failed to dispatch reminder emails.';
          btnSubmitSendReminder.disabled = false;
          btnSubmitSendReminderText.textContent = 'Send Reminder Emails';
        }
      } catch (err) {
        reminderStatusAlert.style.display = 'block';
        reminderStatusAlert.style.background = 'rgba(255, 82, 82, 0.1)';
        reminderStatusAlert.style.border = '1px solid rgba(255, 82, 82, 0.3)';
        reminderStatusAlert.style.color = '#ff8080';
        reminderStatusAlert.textContent = 'Network error during reminder dispatch.';
        btnSubmitSendReminder.disabled = false;
        btnSubmitSendReminderText.textContent = 'Send Reminder Emails';
      }
    });
  }

  // Initial load
  loadAdminData();
});

