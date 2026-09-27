import os
import re
import csv
import io
import random
import time
import threading
import uuid
from datetime import datetime, timezone
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from dotenv import load_dotenv
from flask import Flask, render_template, request, jsonify, session, Response, redirect, url_for
from pymongo import MongoClient, ASCENDING
from pymongo.errors import DuplicateKeyError, PyMongoError

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
load_dotenv(os.path.join(os.path.dirname(__file__), 'atlas-credentials.env'))

app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY', 'findrome_nmims_secret_key_2026')

# SMTP Email Configuration for Event Reminders
SMTP_USERNAME = (os.getenv('SMTP_USERNAME') or os.getenv('SMTP_EMAIL') or '').strip() or None
SMTP_SERVER = (os.getenv('SMTP_SERVER') or '').strip() or ('smtp.gmail.com' if (SMTP_USERNAME and '@gmail.com' in SMTP_USERNAME.lower()) else None)
if SMTP_SERVER:
    SMTP_SERVER = SMTP_SERVER.strip()

_port_raw = (os.getenv('SMTP_PORT') or '587').strip()
try:
    SMTP_PORT = int(_port_raw)
except ValueError:
    SMTP_PORT = 587

SMTP_PASSWORD = os.getenv('SMTP_PASSWORD')
if SMTP_PASSWORD:
    SMTP_PASSWORD = SMTP_PASSWORD.replace(' ', '').replace('\n', '').replace('\r', '').strip()

SMTP_USE_TLS = (os.getenv('SMTP_USE_TLS') or 'true').strip().lower() in ('true', '1', 'yes')
SMTP_USE_SSL = (os.getenv('SMTP_USE_SSL') or 'false').strip().lower() in ('true', '1', 'yes')
SMTP_FROM_EMAIL = (os.getenv('SMTP_FROM_EMAIL') or '').strip() or SMTP_USERNAME or 'noreply@findrome.org'
SMTP_FROM_NAME = (os.getenv('SMTP_FROM_NAME') or 'Findrome Organizing Committee').strip()

def is_smtp_configured():
    return bool(SMTP_SERVER and SMTP_USERNAME and SMTP_PASSWORD)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200

# Security credentials
VOLUNTEER_PIN = os.getenv('VOLUNTEER_PIN', '2026')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', 'admin')

# MongoDB Atlas Connection (High-Concurrency Pool for 1000+ Attendees)
MONGODB_URI = os.getenv('MONGODB_URI')
if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI not found in environment variables or .env file.")

mongo_client = MongoClient(
    MONGODB_URI,
    maxPoolSize=100,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
    socketTimeoutMS=10000,
    maxIdleTimeMS=45000,
    retryWrites=True
)
db_name = os.getenv('MONGODB_DB_NAME', 'findrome_db')
db = mongo_client[db_name]

# ─────────────────────────────────────────────────────────────
# MULTI-EVENT ISOLATED DATABASE ARCHITECTURE
# ─────────────────────────────────────────────────────────────
# Events Master Table & Active Event Pointer
events_master_col = db['events_master']
event_settings_col = db['event_settings']

DEFAULT_EVENT_SETTINGS = {
    '_id': 'findrome_2026',
    'event_code': 'findrome_2026',
    'event_name': 'Fintalks / Finplay',
    'event_edition': '2026',
    'event_title': 'Annual Flagship Financial & Technology Conclave',
    'event_dates': 'September 28 – 29, 2026',
    'event_start_date': '2026-09-28',
    'event_end_date': '2026-09-29',
    'event_venue': 'Mini Auditorium / Finplay: canopy area beside bread and brew',
    'event_subtitle': '',
    'collection_name': 'registrations',
    'created_at': '2026-03-01 00:00:00'
}

def ensure_collection_indexes(col):
    """
    Ensures unique indexes for sap_id, registration_id, and email on an event collection.
    Safely drops any legacy non-unique email_1 index and rebuilds it with unique=True.
    """
    try:
        idx_info = col.index_information()
        if 'email_1' in idx_info and not idx_info['email_1'].get('unique'):
            try:
                col.drop_index('email_1')
            except Exception as drop_err:
                print(f"Index drop notice on {col.name}: {drop_err}")
        col.create_index([('sap_id', ASCENDING)], unique=True)
        col.create_index([('registration_id', ASCENDING)], unique=True)
        col.create_index([('email', ASCENDING)], unique=True)
    except Exception as e:
        print(f"Index setup notice on {col.name}: {e}")

def init_event_defaults():
    """Ensure findrome_2026 exists in events_master and active_event_code is set."""
    try:
        existing = events_master_col.find_one({'_id': 'findrome_2026'})
        if not existing:
            active_cfg = event_settings_col.find_one({'_id': 'active_event_config'})
            doc = DEFAULT_EVENT_SETTINGS.copy()
            if active_cfg:
                for k in ['event_name', 'event_edition', 'event_dates', 'event_start_date', 'event_end_date', 'event_venue']:
                    if active_cfg.get(k):
                        doc[k] = active_cfg[k]
            events_master_col.insert_one(doc)
        else:
            # Sync updated event details (name, edition, dates, venue) to active event
            events_master_col.update_one(
                {'_id': 'findrome_2026'},
                {'$set': {
                    'event_name': DEFAULT_EVENT_SETTINGS['event_name'],
                    'event_edition': DEFAULT_EVENT_SETTINGS['event_edition'],
                    'event_dates': DEFAULT_EVENT_SETTINGS['event_dates'],
                    'event_start_date': DEFAULT_EVENT_SETTINGS['event_start_date'],
                    'event_end_date': DEFAULT_EVENT_SETTINGS['event_end_date'],
                    'event_venue': DEFAULT_EVENT_SETTINGS['event_venue']
                }}
            )

        active_cfg = event_settings_col.find_one({'_id': 'active_event_config'})
        if not active_cfg or not active_cfg.get('active_event_code'):
            event_settings_col.update_one(
                {'_id': 'active_event_config'},
                {'$set': {'active_event_code': 'findrome_2026'}},
                upsert=True
            )
        
        # Pre-index default registrations collection
        legacy_col = db['registrations']
        ensure_collection_indexes(legacy_col)
        print("MongoDB Atlas multi-event system and default indexes initialized.")
    except Exception as e:
        print(f"MongoDB event setup note: {e}")

init_event_defaults()

# In-Memory Cache for High-Concurrency Performance (Sub-millisecond responses)
_event_cache = {
    'active_code': None,
    'settings': {},
    'all_events': None,
    'ts': 0
}
CACHE_TTL = 60 # seconds
_indexed_collections = set()

def invalidate_cache():
    _event_cache['active_code'] = None
    _event_cache['settings'].clear()
    _event_cache['all_events'] = None
    _event_cache['ts'] = 0

def get_active_event_code():
    """Retrieve the currently active event code slug (cached in-memory)."""
    now = time.time()
    if _event_cache['active_code'] and (now - _event_cache['ts'] < CACHE_TTL):
        return _event_cache['active_code']
    try:
        cfg = event_settings_col.find_one({'_id': 'active_event_config'})
        if cfg and cfg.get('active_event_code'):
            _event_cache['active_code'] = cfg['active_event_code']
            _event_cache['ts'] = now
            return cfg['active_event_code']
    except Exception:
        pass
    return 'findrome_2026'

def get_event_settings(event_code=None):
    """Get event configuration document from memory cache or events_master."""
    if not event_code:
        event_code = get_active_event_code()
    now = time.time()
    if event_code in _event_cache['settings'] and (now - _event_cache['ts'] < CACHE_TTL):
        return _event_cache['settings'][event_code]
    try:
        ev = events_master_col.find_one({'_id': event_code})
        if ev:
            _event_cache['settings'][event_code] = ev
            return ev
    except Exception as e:
        print(f"Error getting event settings for {event_code}: {e}")
    return DEFAULT_EVENT_SETTINGS.copy()

def get_registrations_col(event_code=None):
    """
    Returns the isolated MongoDB collection for the specified or active event.
    Only indexes once per worker process to eliminate network latency!
    """
    if not event_code:
        event_code = get_active_event_code()
    
    ev = get_event_settings(event_code)
    col_name = ev.get('collection_name') or ('registrations' if event_code == 'findrome_2026' else f"registrations_{event_code}")
    col = db[col_name]
    
    # Initialize indexes ONCE per collection, not on every request
    if col_name not in _indexed_collections:
        ensure_collection_indexes(col)
        _indexed_collections.add(col_name)
    return col

@app.context_processor
def inject_event_settings():
    """Inject active event details and all events list into every Jinja template (lightning-fast)."""
    active_code = get_active_event_code()
    active_ev = get_event_settings(active_code)
    now = time.time()
    
    if _event_cache['all_events'] and (now - _event_cache['ts'] < CACHE_TTL):
        all_events = _event_cache['all_events']
    else:
        try:
            all_events_cursor = events_master_col.find().sort([('created_at', -1)])
            all_events = []
            for ev in all_events_cursor:
                d = dict(ev)
                d['_id'] = str(d['_id'])
                d['is_active'] = (d.get('event_code') == active_code)
                try:
                    c = get_registrations_col(d.get('event_code'))
                    d['attendee_count'] = c.count_documents({})
                    d['checked_in_count'] = c.count_documents({'status': 'CHECKED_IN'})
                except Exception:
                    d['attendee_count'] = 0
                    d['checked_in_count'] = 0
                all_events.append(d)
            _event_cache['all_events'] = all_events
        except Exception:
            all_events = [active_ev]

    return {
        'settings': active_ev,
        'active_event_code': active_code,
        'all_events': all_events
    }

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')

def format_doc(doc, cfg_or_event_code=None):
    """Clean MongoDB document for JSON responses without redundant DB queries."""
    if not doc:
        return None
    d = dict(doc)
    d['_id'] = str(d['_id'])
    
    if isinstance(cfg_or_event_code, dict):
        cfg = cfg_or_event_code
    else:
        cfg = get_event_settings(cfg_or_event_code or d.get('event_code'))
        
    if not d.get('event_dates'):
        d['event_dates'] = cfg.get('event_dates', 'September 28 – 29, 2026')
    if not d.get('event_venue'):
        d['event_venue'] = cfg.get('event_venue', 'Mini Auditorium / Finplay: canopy area beside bread and brew')
    if not d.get('event_name'):
        d['event_name'] = cfg.get('event_name', 'Fintalks / Finplay')
    if not d.get('event_edition'):
        d['event_edition'] = cfg.get('event_edition', '2026')
    if not d.get('event_code'):
        d['event_code'] = cfg.get('event_code', 'findrome_2026')
    d.setdefault('reminder_sent_at', doc.get('reminder_sent_at'))
    d.setdefault('reminder_count', doc.get('reminder_count', 0))
    return d


# ─────────────────────────────────────────────────────────────
# EVENT REMINDER EMAIL ENGINE (SMTP & TEST SIMULATION)
# ─────────────────────────────────────────────────────────────

def generate_reminder_email_content(attendee, ev_cfg, custom_message=None):
    """Generates modern branded HTML & fallback plain-text reminder notice emails."""
    name = attendee.get('name', 'Attendee')
    reg_id = attendee.get('registration_id', 'PASS-PENDING')
    sap_id = attendee.get('sap_id', '—')
    event_name = ev_cfg.get('event_name', 'Fintalks / Finplay')
    event_edition = ev_cfg.get('event_edition', '2026')
    event_full_title = f"{event_name} {event_edition}".strip()
    event_dates = ev_cfg.get('event_dates') or attendee.get('event_dates') or 'September 28 – 29, 2026'
    event_venue = ev_cfg.get('event_venue') or attendee.get('event_venue') or 'Mini Auditorium / Finplay: canopy area beside bread and brew'
    raw_slot = attendee.get('slot') or ''
    college = attendee.get('college', 'NMIMS')
    program = attendee.get('program', 'Degree')
    branch = attendee.get('branch', 'Specialization')
    year = attendee.get('year_of_study', '')
    status = attendee.get('status', 'CONFIRMED')

    # Format slot and timing cleanly based on official registration form options
    # Form options: "28th | 2:00 PM – 4:00 PM" and "29th | 10:00 AM – 12:00 PM"
    if '28' in raw_slot:
        slot_clean = 'Monday, September 28, 2026 • 2:00 PM – 4:00 PM'
        slot_short_time = '2:00 PM – 4:00 PM'
        arrival_instruction = 'Please be there at the registration desk by 1:30 PM for smooth entry.'
    elif '29' in raw_slot:
        slot_clean = 'Tuesday, September 29, 2026 • 10:00 AM – 12:00 PM'
        slot_short_time = '10:00 AM – 12:00 PM'
        arrival_instruction = 'Please be there at the registration desk by 9:30 AM for smooth entry.'
    elif raw_slot:
        slot_clean = raw_slot
        slot_short_time = raw_slot
        arrival_instruction = 'Please be there at the registration desk by 1:30 PM for smooth entry.'
    else:
        slot_clean = 'September 28 – 29, 2026 (All Sessions)'
        slot_short_time = '1:30 PM'
        arrival_instruction = 'Please be there at the registration desk by 1:30 PM for smooth entry.'

    custom_block_html = ""
    custom_block_text = ""
    if custom_message and custom_message.strip():
        clean_msg = custom_message.strip().replace('\n', '<br>')
        custom_block_html = f"""
        <div style="background: rgba(0, 223, 130, 0.08); border-left: 3px solid #00df82; border-radius: 0 8px 8px 0; padding: 14px 18px; margin: 20px 0; font-size: 14px; color: #d6f5e6; line-height: 1.5;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #00df82; margin-bottom: 4px; letter-spacing: 0.05em;">📢 Important Announcement for Attendees:</div>
          <div>{clean_msg}</div>
        </div>
        """
        custom_block_text = f"\nIMPORTANT ANNOUNCEMENT:\n{custom_message.strip()}\n"

    status_badge_html = """<span style="font-size: 11px; font-weight: 700; color: #00df82; background: rgba(0, 223, 130, 0.15); border: 1px solid rgba(0, 223, 130, 0.35); padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">REGISTERED ATTENDEE</span>"""
    if status == 'CHECKED_IN':
        status_badge_html = """<span style="font-size: 11px; font-weight: 700; color: #00df82; background: rgba(0, 223, 130, 0.25); border: 1px solid #00df82; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">✓ ADMITTED (SCANNED)</span>"""

    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Event Reminder: {event_full_title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #070c09; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e4ebe7;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #070c09; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #0e1512; border: 1px solid #1a2a22; border-radius: 12px; overflow: hidden; box-shadow: 0 16px 40px rgba(0,0,0,0.6);">
          <tr>
            <td height="4" style="background: linear-gradient(90deg, #00df82 0%, #00f08c 50%, #00b368 100%);"></td>
          </tr>
          <tr>
            <td style="padding: 32px 28px 20px; text-align: center; border-bottom: 1px solid #19261f; background: linear-gradient(180deg, #121c17 0%, #0e1512 100%);">
              <div style="display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #00df82; background: rgba(0, 223, 130, 0.12); border: 1px solid rgba(0, 223, 130, 0.28); border-radius: 20px; padding: 4px 14px; margin-bottom: 12px;">
                ⏰ EVENT REMINDER NOTICE
              </div>
              <h1 style="font-size: 24px; font-weight: 700; color: #ffffff; margin: 0 0 6px; letter-spacing: -0.02em;">
                Reminder: {event_full_title} is Approaching!
              </h1>
              <p style="font-size: 13.5px; color: #8ba094; margin: 0;">
                📅 {event_dates} &bull; 📍 {event_venue}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 28px 24px;">
              <p style="font-size: 15.5px; color: #ffffff; margin: 0 0 14px; font-weight: 600;">
                Hello {name},
              </p>
              <p style="font-size: 14px; line-height: 1.6; color: #b8ccc1; margin: 0 0 20px;">
                This is a reminder that you are registered for <strong>{event_full_title}</strong>. We are excited to see you there! Please take note of your scheduled timing, venue, and pass details below:
              </p>

              {custom_block_html}

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #131d18; border: 1px solid #23382c; border-radius: 10px; margin-bottom: 22px; overflow: hidden;">
                <tr>
                  <td style="padding: 16px 20px; border-bottom: 1px dashed #243b2e;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <div style="font-size: 10px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.06em; color: #768f81;">YOUR REGISTERED PASS ID</div>
                          <div style="font-family: monospace; font-size: 18px; font-weight: 700; color: #00df82; letter-spacing: 0.02em; margin-top: 2px;">{reg_id}</div>
                        </td>
                        <td align="right">
                          {status_badge_html}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 13px;">
                      <tr>
                        <td style="color: #768f81; width: 42%; padding: 5px 0;">Your Scheduled Timing:</td>
                        <td style="color: #00df82; font-weight: 700;">{slot_clean}</td>
                      </tr>
                      <tr>
                        <td style="color: #768f81; padding: 5px 0;">Candidate SAP ID:</td>
                        <td style="color: #ffffff; font-weight: 600; font-family: monospace;">{sap_id}</td>
                      </tr>
                      <tr>
                        <td style="color: #768f81; padding: 5px 0;">College / Institute:</td>
                        <td style="color: #ffffff; font-weight: 500;">{college}</td>
                      </tr>
                      <tr>
                        <td style="color: #768f81; padding: 5px 0;">Program & Branch:</td>
                        <td style="color: #ffffff; font-weight: 500;">{program} ({branch} {year})</td>
                      </tr>
                      <tr>
                        <td style="color: #768f81; padding: 5px 0;">Event Conclave Dates:</td>
                        <td style="color: #ffffff; font-weight: 500;">{event_dates}</td>
                      </tr>
                      <tr>
                        <td style="color: #768f81; padding: 5px 0;">Location / Venue:</td>
                        <td style="color: #ffffff; font-weight: 500;">{event_venue}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background: rgba(255, 255, 255, 0.02); border: 1px solid #1a2a22; border-radius: 8px; margin-bottom: 22px;">
                <tr>
                  <td style="padding: 16px 18px;">
                    <div style="font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #00df82; margin-bottom: 8px;">
                      Event Day Reminders:
                    </div>
                    <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #a4b8ad; line-height: 1.6;">
                      <li><strong>Arrival Time:</strong> {arrival_instruction}</li>
                      <li>Carry your valid Student / NMIMS Photo ID Card for verification.</li>
                      <li>Keep this Pass ID (<strong>{reg_id}</strong>) or your SAP ID ready on your phone at entry.</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <p style="font-size: 13px; color: #8ba094; line-height: 1.5; margin: 0;">
                If you have any questions or can no longer attend, please reach out to the Findrome organizing team. We look forward to seeing you at {event_full_title}!
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #090e0c; padding: 20px 28px; text-align: center; border-top: 1px solid #142019; font-size: 12px; color: #587063; line-height: 1.5;">
              <div>Findrome Organizing Committee &bull; {event_full_title}</div>
              <div style="margin-top: 4px; font-size: 11px; color: #43544b;">
                You are receiving this reminder notice because you are registered with {attendee.get('email')}.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    text_content = f"""EVENT REMINDER: {event_full_title}
==================================================

Hello {name},

This is a reminder that you are registered for {event_full_title}!
Event Dates: {event_dates}
Location / Venue: {event_venue}
{custom_block_text}
YOUR SCHEDULE & PASS DETAILS:
- Pass ID: {reg_id}
- Scheduled Timing: {slot_clean}
- Candidate SAP ID: {sap_id}
- College: {college}
- Program: {program} - {branch} {year}
- Event Dates: {event_dates}
- Location / Venue: {event_venue}
- Status: {status}

EVENT DAY REMINDERS:
1. Arrival Time: {arrival_instruction}
2. Carry your valid student photo ID card.
3. Present your Pass ID ({reg_id}) or SAP ID at the scanner gate desk.

We look forward to welcoming you!

Best regards,
Findrome Organizing Committee
({event_full_title})
"""
    return html_content, text_content

def send_single_reminder_email(attendee, ev_cfg, custom_message=None, subject_override=None, smtp_conn=None):
    """Sends a personalized reminder email to one attendee via SMTP or simulated mode."""
    to_email = (attendee.get('email') or '').strip()
    if not to_email:
        return {'success': False, 'message': 'No email address on record', 'to': ''}

    name = attendee.get('name', 'Attendee')
    event_name = ev_cfg.get('event_name', 'Fintalks / Finplay')
    event_edition = ev_cfg.get('event_edition', '2026')
    default_subject = f"⏰ Event Reminder: {event_name} {event_edition} is coming up!".strip()
    subject = subject_override.strip() if (subject_override and subject_override.strip()) else default_subject

    html_body, text_body = generate_reminder_email_content(attendee, ev_cfg, custom_message)

    if is_smtp_configured():
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = formataddr((SMTP_FROM_NAME, SMTP_FROM_EMAIL))
            msg['To'] = formataddr((name, to_email))
            msg.attach(MIMEText(text_body, 'plain', 'utf-8'))
            msg.attach(MIMEText(html_body, 'html', 'utf-8'))

            server_host = (SMTP_SERVER or 'smtp.gmail.com').strip()
            server_port = int(SMTP_PORT or 587)
            local_conn = None
            conn = smtp_conn
            if conn is None:
                if SMTP_USE_SSL:
                    local_conn = smtplib.SMTP_SSL(server_host, server_port, timeout=10)
                else:
                    local_conn = smtplib.SMTP(server_host, server_port, timeout=10)
                    if SMTP_USE_TLS:
                        local_conn.starttls()
                local_conn.login(SMTP_USERNAME, SMTP_PASSWORD)
                conn = local_conn

            try:
                conn.sendmail(SMTP_FROM_EMAIL, [to_email], msg.as_string())
            except Exception as send_err:
                if smtp_conn and conn == smtp_conn:
                    print(f"SMTP connection dropped on {to_email} ({send_err}), reconnecting...")
                    try:
                        new_conn = get_bulk_smtp_connection()
                        if new_conn:
                            conn = new_conn
                            conn.sendmail(SMTP_FROM_EMAIL, [to_email], msg.as_string())
                        else:
                            raise send_err
                    except Exception:
                        raise send_err
                else:
                    raise send_err

            if local_conn:
                try:
                    local_conn.quit()
                except Exception:
                    pass

            return {'success': True, 'mode': 'smtp', 'to': to_email}
        except Exception as e:
            print(f"SMTP send failure for {to_email}: {e}")
            return {'success': False, 'mode': 'smtp', 'error': str(e), 'to': to_email}
    else:
        # Simulated test mode: log cleanly and report success
        print(f"[SIMULATED REMINDER EMAIL] To: {to_email} ({name}) | Pass: {attendee.get('registration_id')} | Subject: {subject}")
        return {'success': True, 'mode': 'simulated', 'to': to_email}

def get_bulk_smtp_connection():
    """Initializes a persistent connection for bulk dispatch to prevent reconnect overhead."""
    if not is_smtp_configured():
        return None
    server_host = (SMTP_SERVER or 'smtp.gmail.com').strip()
    server_port = int(SMTP_PORT or 587)
    try:
        if SMTP_USE_SSL:
            conn = smtplib.SMTP_SSL(server_host, server_port, timeout=15)
        else:
            conn = smtplib.SMTP(server_host, server_port, timeout=15)
            if SMTP_USE_TLS:
                conn.starttls()
        conn.login(SMTP_USERNAME, SMTP_PASSWORD)
        return conn
    except Exception as e:
        print(f"Persistent SMTP connection notice: {e}")
        return None


# ─────────────────────────────────────────────────────────────
# 1. CANDIDATE PORTAL (PUBLIC)
# ─────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/event-config', methods=['GET'])
def api_event_config():
    cfg = get_event_settings()
    cfg['_id'] = str(cfg['_id'])
    return jsonify({'success': True, 'settings': cfg})

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    
    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    phone = (data.get('phone') or '').strip()
    sap_id = (data.get('sap_id') or '').strip()
    college = (data.get('college') or '').strip()
    program = (data.get('program') or '').strip()
    year_of_study = (data.get('year_of_study') or '').strip()
    branch = (data.get('branch') or '').strip()
    slot = (data.get('slot') or '').strip()

    errors = {}

    # Validation: Name
    if not name:
        errors['name'] = 'This field is required.'
    elif len(name) < 2:
        errors['name'] = 'Please enter a valid full name.'

    # Validation: Email
    if not email:
        errors['email'] = 'This field is required.'
    elif not EMAIL_REGEX.match(email):
        errors['email'] = 'Please enter a valid email address.'

    # Validation: Phone Number (10 digits)
    if not phone:
        errors['phone'] = 'This field is required.'
    elif not (phone.isdigit() and len(phone) == 10):
        errors['phone'] = 'Phone number must be exactly 10 digits.'

    # Validation: SAP ID (11 digits)
    if not sap_id:
        errors['sap_id'] = 'This field is required.'
    elif not (sap_id.isdigit() and len(sap_id) == 11):
        errors['sap_id'] = 'SAP ID must be exactly 11 digits.'

    # Validation: College
    if not college:
        errors['college'] = 'Please select your college.'
    elif college not in ('MPSTME', 'ASMSOC', 'Other'):
        errors['college'] = 'Please select a valid college.'

    # Validation: Program
    if not program:
        errors['program'] = 'Please select your program / degree.'

    # Validation: Year
    if not year_of_study:
        errors['year_of_study'] = 'Please select your year of study.'

    # Validation: Branch
    if not branch:
        errors['branch'] = 'This field is required.'

    # Validation: Slot
    valid_slots = ['28th | 2:00 PM \u2013 4:00 PM', '29th | 10:00 AM \u2013 12:00 PM']
    if not slot:
        errors['slot'] = 'Please select an event slot.'
    elif slot not in valid_slots:
        errors['slot'] = 'Please select a valid event slot.'

    if errors:
        return jsonify({'success': False, 'errors': errors}), 400

    # Duplicate check in MongoDB Atlas (Isolated to this active event!)
    col = get_registrations_col()
    existing_sap = col.find_one({'sap_id': sap_id})
    if existing_sap:
        return jsonify({
            'success': False,
            'errors': {'sap_id': 'A registration with this SAP ID already exists for this event.'}
        }), 409

    existing_email = col.find_one({'email': email})
    if existing_email:
        return jsonify({
            'success': False,
            'errors': {'email': 'A registration with this email address already exists for this event.'}
        }), 409

    # Generate unique ticket ID
    while True:
        reg_number = random.randint(1000, 9999)
        registration_id = f"FD-NMIMS-{reg_number}"
        if not col.find_one({'registration_id': registration_id}):
            break

    now_iso = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    now_display = datetime.now(timezone.utc).strftime('%b %d, %Y %I:%M %p UTC')

    cfg = get_event_settings()
    record = {
        'registration_id': registration_id,
        'name': name,
        'email': email,
        'phone': phone,
        'sap_id': sap_id,
        'college': college,
        'program': program,
        'year_of_study': year_of_study,
        'branch': branch,
        'slot': slot,
        'event_code': cfg.get('event_code', 'findrome_2026'),
        'event_name': cfg.get('event_name', 'Findrome'),
        'event_edition': cfg.get('event_edition', '2026'),
        'event_dates': cfg.get('event_dates', 'Event Dates TBA'),
        'event_venue': cfg.get('event_venue', 'NMIMS Mumbai Campus'),
        'status': 'CONFIRMED',
        'checked_in_at': None,
        'created_at': now_iso,
        'timestamp': now_display
    }

    try:
        col.insert_one(record)
    except DuplicateKeyError as e:
        err_msg = str(e).lower()
        if 'email' in err_msg:
            return jsonify({
                'success': False,
                'errors': {'email': 'A registration with this email address already exists for this event.'}
            }), 409
        elif 'sap_id' in err_msg:
            return jsonify({
                'success': False,
                'errors': {'sap_id': 'A registration with this SAP ID already exists for this event.'}
            }), 409
        else:
            return jsonify({
                'success': False,
                'errors': {'sap_id': 'A registration with this SAP ID or Email already exists for this event.'}
            }), 409

    return jsonify({
        'success': True,
        'message': 'Registration successful!',
        'registration_id': registration_id,
        'data': format_doc(record)
    }), 201

@app.route('/api/lookup', methods=['GET'])
def lookup_pass():
    query = (request.args.get('query') or '').strip()
    if not query:
        return jsonify({'success': False, 'message': 'Please provide your SAP ID or Email.'}), 400

    col = get_registrations_col()
    doc = col.find_one({
        '$or': [
            {'sap_id': query},
            {'email': {'$regex': f'^{re.escape(query)}$', '$options': 'i'}},
            {'registration_id': query.upper()}
        ]
    })

    # If not found in active event, search across historical events
    if not doc:
        try:
            for ev in events_master_col.find():
                if ev.get('event_code') != get_active_event_code():
                    past_col = get_registrations_col(ev.get('event_code'))
                    doc = past_col.find_one({
                        '$or': [
                            {'sap_id': query},
                            {'email': {'$regex': f'^{re.escape(query)}$', '$options': 'i'}},
                            {'registration_id': query.upper()}
                        ]
                    })
                    if doc:
                        break
        except Exception:
            pass

    if not doc:
        return jsonify({'success': False, 'message': 'No registration found for the provided details.'}), 404

    return jsonify({'success': True, 'data': format_doc(doc)})

@app.route('/api/public-count', methods=['GET'])
def public_count():
    col = get_registrations_col()
    total = col.count_documents({})
    return jsonify({'total': total})


# ─────────────────────────────────────────────────────────────
# 2. SECURED VOLUNTEER SCANNER DESK (/volunteer)
# ─────────────────────────────────────────────────────────────

@app.route('/scanner')
def redirect_scanner():
    """Redirect old scanner URL to secured volunteer portal."""
    return redirect(url_for('volunteer_portal'))

@app.route('/volunteer')
def volunteer_portal():
    is_authenticated = session.get('volunteer_auth', False)
    return render_template('volunteer.html', is_authenticated=is_authenticated)

@app.route('/api/volunteer/login', methods=['POST'])
def volunteer_login():
    data = request.get_json() or {}
    pin = (data.get('pin') or '').strip()

    if pin == VOLUNTEER_PIN:
        session['volunteer_auth'] = True
        return jsonify({'success': True, 'message': 'Volunteer PIN verified.'})
    else:
        return jsonify({'success': False, 'message': 'Invalid Volunteer PIN. Access denied.'}), 401

@app.route('/api/volunteer/logout', methods=['POST'])
def volunteer_logout():
    session.pop('volunteer_auth', None)
    return jsonify({'success': True})

@app.route('/api/verify', methods=['POST'])
def verify_ticket():
    # Enforce volunteer authentication
    if not session.get('volunteer_auth') and not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Unauthorized: Volunteer PIN required.'}), 403

    data = request.get_json() or {}
    raw_code = (data.get('ticket_id') or data.get('code') or '').strip()

    if not raw_code:
        return jsonify({'success': False, 'message': 'No ticket code or SAP ID provided.'}), 400

    # Match ticket ID if full URL was scanned
    match = re.search(r'(FD-NMIMS-\d{4})', raw_code, re.IGNORECASE)
    if match:
        query_code = match.group(1).upper()
    else:
        query_code = raw_code.upper()

    target_col = get_registrations_col()
    doc = target_col.find_one({
        '$or': [
            {'registration_id': query_code},
            {'sap_id': raw_code},
            {'email': raw_code.lower()}
        ]
    })

    # If not found in active event, check across past event collections
    if not doc:
        try:
            for ev in events_master_col.find():
                if ev.get('event_code') != get_active_event_code():
                    past_col = get_registrations_col(ev.get('event_code'))
                    found = past_col.find_one({
                        '$or': [
                            {'registration_id': query_code},
                            {'sap_id': raw_code},
                            {'email': raw_code.lower()}
                        ]
                    })
                    if found:
                        doc = found
                        target_col = past_col
                        break
        except Exception:
            pass

    if not doc:
        return jsonify({
            'success': False,
            'valid': False,
            'message': f'Pass "{raw_code}" not found! Please check with registration desk.'
        }), 404

    # Check if already checked in
    if doc.get('status') == 'CHECKED_IN':
        return jsonify({
            'success': True,
            'valid': True,
            'already_checked_in': True,
            'message': 'WARNING: This pass was ALREADY scanned & checked in!',
            'checked_in_at': doc.get('checked_in_at'),
            'data': format_doc(doc)
        }), 200

    # First time admission
    now_str = datetime.now().strftime('%b %d, %Y %I:%M:%S %p')
    target_col.update_one(
        {'_id': doc['_id']},
        {'$set': {'status': 'CHECKED_IN', 'checked_in_at': now_str}}
    )

    doc['status'] = 'CHECKED_IN'
    doc['checked_in_at'] = now_str

    return jsonify({
        'success': True,
        'valid': True,
        'already_checked_in': False,
        'message': 'ACCESS GRANTED: Candidate verified successfully!',
        'checked_in_at': now_str,
        'data': format_doc(doc)
    }), 200

@app.route('/api/volunteer/toggle-checkin', methods=['POST'])
def volunteer_toggle_checkin():
    if not session.get('volunteer_auth') and not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Unauthorized: Volunteer PIN required.'}), 403

    data = request.get_json() or {}
    reg_id = (data.get('registration_id') or '').strip()

    if not reg_id:
        return jsonify({'success': False, 'message': 'Registration ID required.'}), 400

    target_col = get_registrations_col()
    doc = target_col.find_one({'registration_id': reg_id})
    if not doc:
        for ev in events_master_col.find():
            if ev.get('event_code') != get_active_event_code():
                c = get_registrations_col(ev.get('event_code'))
                found = c.find_one({'registration_id': reg_id})
                if found:
                    doc = found
                    target_col = c
                    break

    if not doc:
        return jsonify({'success': False, 'message': 'Record not found.'}), 404

    if doc.get('status') == 'CHECKED_IN':
        target_col.update_one(
            {'_id': doc['_id']},
            {'$set': {'status': 'CONFIRMED', 'checked_in_at': None}}
        )
        return jsonify({'success': True, 'status': 'CONFIRMED', 'message': f'Admission for {doc.get("name")} reset to Confirmed.'})
    else:
        now_str = datetime.now().strftime('%b %d, %Y %I:%M:%S %p')
        target_col.update_one(
            {'_id': doc['_id']},
            {'$set': {'status': 'CHECKED_IN', 'checked_in_at': now_str}}
        )
        return jsonify({'success': True, 'status': 'CHECKED_IN', 'message': f'{doc.get("name")} admitted and checked in.'})

@app.route('/api/check-in-stats', methods=['GET'])
def check_in_stats():
    # Requires volunteer or admin access
    if not session.get('volunteer_auth') and not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Unauthorized.'}), 403

    col = get_registrations_col()
    total = col.count_documents({})
    checked_in = col.count_documents({'status': 'CHECKED_IN'})
    pct = round((checked_in / total * 100), 1) if total > 0 else 0

    recent_cursor = col.find({'status': 'CHECKED_IN'}).sort([('_id', -1)]).limit(10)
    recent = [format_doc(r) for r in recent_cursor]

    return jsonify({
        'total_registered': total,
        'total_checked_in': checked_in,
        'attendance_percentage': pct,
        'recent_checkins': recent
    })


# ─────────────────────────────────────────────────────────────
# 3. SECURED ADMIN PORTAL & EXCEL EXPORT (/admin)
# ─────────────────────────────────────────────────────────────

@app.route('/admin')
def admin_portal():
    is_authenticated = session.get('admin_auth', False)
    return render_template('admin.html', is_authenticated=is_authenticated)

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json() or {}
    pwd = (data.get('password') or '').strip()

    if pwd == ADMIN_PASSWORD:
        session['admin_auth'] = True
        return jsonify({'success': True, 'message': 'Admin authenticated successfully.'})
    else:
        return jsonify({'success': False, 'message': 'Invalid Admin Password. Access denied.'}), 401

@app.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    session.pop('admin_auth', None)
    return jsonify({'success': True})

@app.route('/api/admin/registrations', methods=['GET'])
def admin_registrations():
    if not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Admin authentication required.'}), 403

    event_code = (request.args.get('event_code') or '').strip() or get_active_event_code()
    col = get_registrations_col(event_code)
    ev_cfg = get_event_settings(event_code)

    search = (request.args.get('search') or '').strip()
    program_filter = (request.args.get('program') or request.args.get('status') or '').strip()

    query = {}
    if search:
        regex_pattern = {'$regex': re.escape(search), '$options': 'i'}
        query['$or'] = [
            {'name': regex_pattern},
            {'sap_id': regex_pattern},
            {'email': regex_pattern},
            {'registration_id': regex_pattern},
            {'college': regex_pattern},
            {'branch': regex_pattern},
            {'program': regex_pattern}
        ]

    if program_filter and program_filter != 'ALL':
        if program_filter == 'CHECKED_IN':
            query['status'] = 'CHECKED_IN'
        elif program_filter == 'CONFIRMED':
            query['status'] = {'$ne': 'CHECKED_IN'}
        elif program_filter == 'OTHER':
            query['program'] = {'$nin': ['B.Tech', 'MBA Tech']}
        else:
            query['program'] = program_filter

    cursor = col.find(query).sort([('_id', -1)])
    data = [format_doc(doc, ev_cfg) for doc in cursor]

    # Fast single-pass metrics in 1 database roundtrip (Sub-millisecond)
    try:
        pipeline = [
            {
                '$facet': {
                    'total': [{'$count': 'c'}],
                    'btech': [{'$match': {'program': 'B.Tech'}}, {'$count': 'c'}],
                    'mbatech': [{'$match': {'program': 'MBA Tech'}}, {'$count': 'c'}],
                    'other': [{'$match': {'program': {'$nin': ['B.Tech', 'MBA Tech']}}}, {'$count': 'c'}],
                    'checked_in': [{'$match': {'status': 'CHECKED_IN'}}, {'$count': 'c'}]
                }
            }
        ]
        facet_res = list(col.aggregate(pipeline))
        facet = facet_res[0] if facet_res else {}
        total = facet.get('total', [{}])[0].get('c', 0) if facet.get('total') else 0
        btech_count = facet.get('btech', [{}])[0].get('c', 0) if facet.get('btech') else 0
        mbatech_count = facet.get('mbatech', [{}])[0].get('c', 0) if facet.get('mbatech') else 0
        other_count = facet.get('other', [{}])[0].get('c', 0) if facet.get('other') else 0
        checked_in = facet.get('checked_in', [{}])[0].get('c', 0) if facet.get('checked_in') else 0
    except Exception:
        total = col.count_documents({})
        btech_count = col.count_documents({'program': 'B.Tech'})
        mbatech_count = col.count_documents({'program': 'MBA Tech'})
        other_count = col.count_documents({'program': {'$nin': ['B.Tech', 'MBA Tech']}})
        checked_in = col.count_documents({'status': 'CHECKED_IN'})

    pct = round((checked_in / total * 100), 1) if total > 0 else 0
    pending_count = max(0, total - checked_in)

    return jsonify({
        'success': True,
        'event_code': event_code,
        'event_name': ev_cfg.get('event_name', 'Findrome'),
        'event_edition': ev_cfg.get('event_edition', ''),
        'event_dates': ev_cfg.get('event_dates', ''),
        'event_venue': ev_cfg.get('event_venue', ''),
        'is_active': (event_code == get_active_event_code()),
        'total': total,
        'checked_in': checked_in,
        'pending': pending_count,
        'attendance_percentage': pct,
        'btech_count': btech_count,
        'mbatech_count': mbatech_count,
        'other_count': other_count,
        'filtered_count': len(data),
        'registrations': data
    })

@app.route('/api/admin/events', methods=['GET'])
def api_admin_list_events():
    """Returns list of all events and their registration counts for the admin switcher."""
    if not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Admin authentication required.'}), 403

    active_code = get_active_event_code()
    events_list = []
    for ev in events_master_col.find().sort([('created_at', -1)]):
        d = dict(ev)
        d['_id'] = str(d['_id'])
        code = d.get('event_code')
        try:
            c = get_registrations_col(code)
            d['attendee_count'] = c.count_documents({})
            d['checked_in_count'] = c.count_documents({'status': 'CHECKED_IN'})
        except Exception:
            d['attendee_count'] = 0
            d['checked_in_count'] = 0
        d['is_active'] = (code == active_code)
        events_list.append(d)

    return jsonify({
        'success': True,
        'active_event_code': active_code,
        'events': events_list
    })

@app.route('/api/admin/create-event', methods=['POST'])
def api_admin_create_event():
    """
    Creates a brand new event with its own isolated MongoDB registration collection.
    Guarantees that new events start at 0 registrations and don't mix with past events!
    """
    if not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Admin authentication required.'}), 403

    data = request.get_json() or {}
    event_name = (data.get('event_name') or '').strip() or 'Findrome'
    event_edition = (data.get('event_edition') or '').strip() or '2027'
    event_dates = (data.get('event_dates') or '').strip()
    event_start_date = (data.get('event_start_date') or '').strip()
    event_end_date = (data.get('event_end_date') or '').strip()
    event_venue = (data.get('event_venue') or '').strip() or 'NMIMS Mumbai Campus'
    is_active = data.get('is_active', True)

    # Clean slug for event code & MongoDB collection
    slug_base = re.sub(r'[^a-zA-Z0-9]+', '_', f"{event_name}_{event_edition}".lower()).strip('_')
    if not slug_base:
        slug_base = f"event_{int(time.time())}"
    
    event_code = slug_base
    suffix = 1
    while events_master_col.find_one({'_id': event_code}):
        suffix += 1
        event_code = f"{slug_base}_{suffix}"

    # Format dates if left blank but pickers used
    if not event_dates and event_start_date:
        try:
            d_start = datetime.strptime(event_start_date, '%Y-%m-%d')
            if event_end_date and event_end_date != event_start_date:
                d_end = datetime.strptime(event_end_date, '%Y-%m-%d')
                if d_start.month == d_end.month and d_start.year == d_end.year:
                    event_dates = f"{d_start.strftime('%B %d')} – {d_end.strftime('%d, %Y')}"
                else:
                    event_dates = f"{d_start.strftime('%B %d, %Y')} – {d_end.strftime('%B %d, %Y')}"
            else:
                event_dates = d_start.strftime('%B %d, %Y')
        except Exception:
            event_dates = event_start_date
    elif not event_dates:
        event_dates = 'Event Dates TBA'

    col_name = f"registrations_{event_code}"
    new_event_doc = {
        '_id': event_code,
        'event_code': event_code,
        'event_name': event_name,
        'event_edition': event_edition,
        'event_title': f"{event_name} {event_edition}",
        'event_dates': event_dates,
        'event_start_date': event_start_date,
        'event_end_date': event_end_date,
        'event_venue': event_venue,
        'event_subtitle': '',
        'collection_name': col_name,
        'created_at': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    }

    events_master_col.insert_one(new_event_doc)

    # Initialize unique indexes for this dedicated collection
    new_col = db[col_name]
    ensure_collection_indexes(new_col)
    _indexed_collections.add(col_name)

    # If active, switch live registration form to this event
    if is_active:
        event_settings_col.update_one(
            {'_id': 'active_event_config'},
            {'$set': {'active_event_code': event_code}},
            upsert=True
        )

    invalidate_cache()

    return jsonify({
        'success': True,
        'message': f"New event '{event_name} {event_edition}' created with isolated collection '{col_name}'!",
        'event_code': event_code,
        'is_active': is_active
    }), 201

@app.route('/api/admin/switch-event', methods=['POST'])
def api_admin_switch_event():
    """Sets which event is the active live registration form for public users."""
    if not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Admin authentication required.'}), 403

    data = request.get_json() or {}
    event_code = (data.get('event_code') or '').strip()
    if not event_code:
        return jsonify({'success': False, 'message': 'Please provide an event code.'}), 400

    ev = events_master_col.find_one({'_id': event_code})
    if not ev:
        return jsonify({'success': False, 'message': 'Event not found.'}), 404

    event_settings_col.update_one(
        {'_id': 'active_event_config'},
        {'$set': {'active_event_code': event_code}},
        upsert=True
    )

    invalidate_cache()

    return jsonify({
        'success': True,
        'message': f"Active live registration form switched to '{ev.get('event_name')} {ev.get('event_edition')}'!",
        'active_event_code': event_code
    })

@app.route('/api/admin/delete-event', methods=['POST'])
def api_admin_delete_event():
    """
    Permanently deletes an event and drops its isolated registration collection in MongoDB Atlas.
    Safety Guardrails:
    1. Admin authentication required.
    2. Cannot delete the active live event (must switch first).
    3. Cannot delete the only remaining event.
    """
    if not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Admin authentication required.'}), 403

    data = request.get_json() or {}
    event_code = (data.get('event_code') or '').strip()
    if not event_code:
        return jsonify({'success': False, 'message': 'Event code is required.'}), 400

    ev = events_master_col.find_one({'_id': event_code})
    if not ev:
        return jsonify({'success': False, 'message': 'Event not found.'}), 404

    active_code = get_active_event_code()
    if event_code == active_code:
        return jsonify({
            'success': False,
            'message': 'Cannot delete the active live event. Please switch the live registration form to another event first.'
        }), 400

    total_events = events_master_col.count_documents({})
    if total_events <= 1:
        return jsonify({
            'success': False,
            'message': 'Cannot delete the only remaining event in the database.'
        }), 400

    # Determine collection name to drop
    col_name = ev.get('collection_name') or ('registrations' if event_code == 'findrome_2026' else f"registrations_{event_code}")

    # Drop the dedicated registrations collection
    try:
        db.drop_collection(col_name)
    except Exception as e:
        print(f"Notice dropping collection {col_name}: {e}")

    # Delete the master event record
    events_master_col.delete_one({'_id': event_code})

    # Clear from tracking
    _indexed_collections.discard(col_name)

    # Invalidate cache
    invalidate_cache()

    event_display_title = f"{ev.get('event_name', 'Event')} {ev.get('event_edition', '')}".strip()

    return jsonify({
        'success': True,
        'message': f"Event '{event_display_title}' and its registrations were permanently deleted.",
        'deleted_event_code': event_code
    })


@app.route('/api/admin/event-config', methods=['POST'])
def api_admin_event_config():
    """Allows Administrator to update Event Dates, Venue, and Info in MongoDB Atlas."""
    if not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Admin authentication required.'}), 403

    data = request.get_json() or {}
    event_code = (data.get('event_code') or '').strip() or get_active_event_code()
    event_name = (data.get('event_name') or '').strip() or 'Findrome'
    event_edition = (data.get('event_edition') or '').strip() or '2026'
    event_dates = (data.get('event_dates') or '').strip()
    event_start_date = (data.get('event_start_date') or '').strip()
    event_end_date = (data.get('event_end_date') or '').strip()
    event_venue = (data.get('event_venue') or '').strip() or 'NMIMS Mumbai Campus'
    event_subtitle = (data.get('event_subtitle') or '').strip()

    # If event_dates was left blank but dates were picked, format them nicely
    if not event_dates and event_start_date:
        try:
            d_start = datetime.strptime(event_start_date, '%Y-%m-%d')
            if event_end_date and event_end_date != event_start_date:
                d_end = datetime.strptime(event_end_date, '%Y-%m-%d')
                if d_start.month == d_end.month and d_start.year == d_end.year:
                    event_dates = f"{d_start.strftime('%B %d')} – {d_end.strftime('%d, %Y')}"
                else:
                    event_dates = f"{d_start.strftime('%B %d, %Y')} – {d_end.strftime('%B %d, %Y')}"
            else:
                event_dates = d_start.strftime('%B %d, %Y')
        except Exception:
            event_dates = event_start_date
    elif not event_dates:
        event_dates = 'Event Dates TBA'

    update_fields = {
        'event_name': event_name,
        'event_edition': event_edition,
        'event_dates': event_dates,
        'event_start_date': event_start_date,
        'event_end_date': event_end_date,
        'event_venue': event_venue,
        'event_subtitle': event_subtitle,
        'updated_at': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    }

    events_master_col.update_one(
        {'_id': event_code},
        {'$set': update_fields},
        upsert=True
    )

    invalidate_cache()

    return jsonify({
        'success': True,
        'message': 'Event schedule and details updated successfully in MongoDB Atlas!',
        'settings': update_fields
    })

@app.route('/admin/export', methods=['GET'])
def admin_export_excel():
    """Download full registrations spreadsheet in Excel-compatible CSV format for the selected event."""
    if not session.get('admin_auth'):
        return redirect(url_for('admin_portal'))

    event_code = (request.args.get('event_code') or '').strip() or get_active_event_code()
    col = get_registrations_col(event_code)
    ev_cfg = get_event_settings(event_code)

    output = io.StringIO()
    # Write UTF-8 BOM so Excel opens it with proper encoding
    output.write('\ufeff')
    writer = csv.writer(output)

    # Header Row
    writer.writerow([
        'Registration ID',
        'Full Name',
        'Email Address',
        'Phone Number',
        'SAP ID',
        'College',
        'Program / Degree',
        'Year of Study',
        'Branch / Specialization',
        'Event Slot',
        'Check-In Status',
        'Admitted / Check-In Timestamp',
        'Registered At',
        'Event Name',
        'Event Edition',
        'Reminder Sent At',
        'Reminder Count'
    ])

    cursor = col.find().sort([('_id', 1)])
    for doc in cursor:
        writer.writerow([
            doc.get('registration_id', ''),
            doc.get('name', ''),
            doc.get('email', ''),
            doc.get('phone', ''),
            doc.get('sap_id', ''),
            doc.get('college', ''),
            doc.get('program', ''),
            doc.get('year_of_study', ''),
            doc.get('branch', ''),
            doc.get('slot', ''),
            doc.get('status', 'CONFIRMED'),
            doc.get('checked_in_at', '') or '—',
            doc.get('timestamp', '') or doc.get('created_at', ''),
            doc.get('event_name', ev_cfg.get('event_name', '')),
            doc.get('event_edition', ev_cfg.get('event_edition', '')),
            doc.get('reminder_sent_at', '') or '—',
            doc.get('reminder_count', 0)
        ])

    csv_data = output.getvalue()
    clean_slug = re.sub(r'[^a-zA-Z0-9_]', '_', event_code)
    filename = f"{clean_slug}_attendees_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    return Response(
        csv_data,
        mimetype='text/csv; charset=utf-8',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Type': 'text/csv; charset=utf-8'
        }
    )

@app.route('/api/admin/toggle-checkin', methods=['POST'])
def admin_toggle_checkin():
    if not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Unauthorized.'}), 403

    data = request.get_json() or {}
    reg_id = data.get('registration_id')

    target_col = get_registrations_col()
    doc = target_col.find_one({'registration_id': reg_id})
    if not doc:
        # Check other collections
        for ev in events_master_col.find():
            if ev.get('event_code') != get_active_event_code():
                c = get_registrations_col(ev.get('event_code'))
                found = c.find_one({'registration_id': reg_id})
                if found:
                    doc = found
                    target_col = c
                    break

    if not doc:
        return jsonify({'success': False, 'message': 'Record not found.'}), 404

    if doc.get('status') == 'CHECKED_IN':
        # Reset to CONFIRMED
        target_col.update_one(
            {'_id': doc['_id']},
            {'$set': {'status': 'CONFIRMED', 'checked_in_at': None}}
        )
        return jsonify({'success': True, 'status': 'CONFIRMED', 'message': 'Status reset to Confirmed.'})
    else:
        # Mark as CHECKED_IN
        now_str = datetime.now().strftime('%b %d, %Y %I:%M:%S %p')
        target_col.update_one(
            {'_id': doc['_id']},
            {'$set': {'status': 'CHECKED_IN', 'checked_in_at': now_str}}
        )
        return jsonify({'success': True, 'status': 'CHECKED_IN', 'message': 'Attendee marked as Checked In.'})


@app.route('/api/admin/smtp-status', methods=['GET'])
def api_admin_smtp_status():
    """Returns email delivery mode and SMTP server configuration status."""
    if not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Admin authentication required.'}), 403

    configured = is_smtp_configured()
    return jsonify({
        'success': True,
        'is_configured': configured,
        'server': SMTP_SERVER if configured else None,
        'port': SMTP_PORT if configured else None,
        'sender_email': SMTP_FROM_EMAIL if configured else None,
        'sender_name': SMTP_FROM_NAME if configured else None,
        'mode': 'smtp' if configured else 'simulated'
    })


# In-memory bulk reminder job tracker for high-capacity production dispatch
_reminder_jobs = {}

def _run_bulk_reminder_worker(job_id, recipients, ev_cfg, custom_message, subject_override, event_code):
    """Executes bulk email dispatch in a background thread, updating live progress."""
    job = _reminder_jobs.get(job_id)
    if not job:
        return

    col = get_registrations_col(event_code)
    smtp_conn = get_bulk_smtp_connection()
    now_str = datetime.now().strftime('%b %d, %Y %I:%M %p')

    for attendee in recipients:
        try:
            res = send_single_reminder_email(attendee, ev_cfg, custom_message, subject_override, smtp_conn=smtp_conn)
            if res.get('success'):
                job['sent_count'] += 1
                try:
                    col.update_one(
                        {'_id': attendee['_id']},
                        {
                            '$set': {'reminder_sent_at': now_str},
                            '$inc': {'reminder_count': 1}
                        }
                    )
                except Exception as update_err:
                    print(f"Notice updating reminder timestamp: {update_err}")
            else:
                job['failed_count'] += 1
                if res.get('error'):
                    job['errors'].append(f"{attendee.get('email')}: {res.get('error')}")
        except Exception as item_err:
            job['failed_count'] += 1
            job['errors'].append(f"{attendee.get('email')}: {str(item_err)}")
        
        # Micro-sleep (25ms) between emails to prevent burst throttling
        time.sleep(0.025)

    if smtp_conn:
        try:
            smtp_conn.quit()
        except Exception:
            pass

    job['status'] = 'completed'
    job['finished_at'] = datetime.now().strftime('%b %d, %Y %I:%M %p')
    job['reminder_sent_at'] = now_str


@app.route('/api/admin/reminder-job/<job_id>', methods=['GET'])
def api_admin_reminder_job(job_id):
    """Returns real-time progress for an asynchronous bulk reminder dispatch job."""
    if not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Admin authentication required.'}), 403
    job = _reminder_jobs.get(job_id)
    if not job:
        return jsonify({'success': False, 'message': 'Reminder job not found.'}), 404
    return jsonify({'success': True, 'job': job})


@app.route('/api/admin/send-reminder', methods=['POST'])
def api_admin_send_reminder():
    """
    Sends personalized reminder emails to attendees registered for the selected event.
    Supports targeting all attendees, pending entry attendees, a single attendee,
    or dispatching a sample test email to an administrator.
    For large groups (>5), dispatches in a background thread to prevent cloud gateway timeouts.
    """
    if not session.get('admin_auth'):
        return jsonify({'success': False, 'message': 'Admin authentication required.'}), 403

    data = request.get_json() or {}
    event_code = (data.get('event_code') or '').strip() or get_active_event_code()
    target = data.get('target', 'all')  # 'all', 'pending', 'single'
    target_reg_id = (data.get('registration_id') or '').strip()
    custom_message = (data.get('custom_message') or '').strip()
    subject_override = (data.get('subject') or '').strip()
    test_email = (data.get('test_email') or '').strip()

    col = get_registrations_col(event_code)
    ev_cfg = get_event_settings(event_code)

    # 1. Single test email directly to admin inbox
    if test_email:
        sample_doc = col.find_one() or {
            'registration_id': 'FD-SAMPLE-2026',
            'name': 'Sample Delegate',
            'email': test_email,
            'phone': '9876543210',
            'sap_id': '70012023000',
            'college': 'MPSTME',
            'program': 'B.Tech',
            'branch': 'Computer Science',
            'year_of_study': '3rd Year',
            'slot': '28th | 2:00 PM – 4:00 PM',
            'status': 'CONFIRMED'
        }
        test_attendee = dict(sample_doc)
        test_attendee['email'] = test_email
        test_attendee['name'] = f"Admin Preview ({test_attendee.get('name')})"

        res = send_single_reminder_email(test_attendee, ev_cfg, custom_message, subject_override)
        if res.get('success'):
            mode_desc = 'live via SMTP' if res.get('mode') == 'smtp' else 'in simulated test mode'
            return jsonify({
                'success': True,
                'message': f"Test reminder email dispatched {mode_desc} to {test_email}!",
                'sent_count': 1,
                'mode': res.get('mode')
            })
        else:
            return jsonify({
                'success': False,
                'message': f"Failed to send test email: {res.get('error', 'SMTP dispatch failed')}",
                'mode': res.get('mode')
            }), 500

    # 2. Build target query
    query = {'email': {'$exists': True, '$ne': ''}}
    if target == 'single':
        if not target_reg_id:
            return jsonify({'success': False, 'message': 'Registration ID is required for a single attendee reminder.'}), 400
        query['registration_id'] = target_reg_id
    elif target == 'pending':
        query['status'] = {'$ne': 'CHECKED_IN'}

    recipients = list(col.find(query))
    if not recipients:
        return jsonify({
            'success': False,
            'message': 'No registered attendees found matching the selected target criteria.'
        }), 404

    # 3. Asynchronous background dispatch for batches (>5 attendees) to prevent cloud HTTP gateway timeouts
    is_async = (len(recipients) > 5) and not data.get('sync', False)

    if is_async:
        job_id = f"rem_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        _reminder_jobs[job_id] = {
            'job_id': job_id,
            'status': 'in_progress',
            'sent_count': 0,
            'failed_count': 0,
            'total_target': len(recipients),
            'errors': [],
            'started_at': datetime.now().strftime('%b %d, %Y %I:%M %p'),
            'finished_at': None,
            'event_display_name': f"{ev_cfg.get('event_name', 'Event')} {ev_cfg.get('event_edition', '')}".strip()
        }

        thread = threading.Thread(
            target=_run_bulk_reminder_worker,
            args=(job_id, recipients, ev_cfg, custom_message, subject_override, event_code),
            daemon=True
        )
        thread.start()

        return jsonify({
            'success': True,
            'async': True,
            'job_id': job_id,
            'total_target': len(recipients),
            'mode': 'smtp' if is_smtp_configured() else 'simulated',
            'message': f"Bulk reminder dispatch for {len(recipients)} attendees started in background."
        })

    # 4. Synchronous dispatch for small batches or test runs
    smtp_conn = get_bulk_smtp_connection()
    sent_count = 0
    failed_count = 0
    errors = []

    now_str = datetime.now().strftime('%b %d, %Y %I:%M %p')

    for attendee in recipients:
        res = send_single_reminder_email(attendee, ev_cfg, custom_message, subject_override, smtp_conn=smtp_conn)
        if res.get('success'):
            sent_count += 1
            try:
                col.update_one(
                    {'_id': attendee['_id']},
                    {
                        '$set': {'reminder_sent_at': now_str},
                        '$inc': {'reminder_count': 1}
                    }
                )
            except Exception as update_err:
                print(f"Notice updating reminder timestamp for {attendee.get('registration_id')}: {update_err}")
        else:
            failed_count += 1
            if res.get('error'):
                errors.append(f"{attendee.get('email')}: {res.get('error')}")

    if smtp_conn:
        try:
            smtp_conn.quit()
        except Exception:
            pass

    mode_label = 'live via SMTP' if is_smtp_configured() else 'simulated in test mode'
    event_display_name = f"{ev_cfg.get('event_name', 'Event')} {ev_cfg.get('event_edition', '')}".strip()

    return jsonify({
        'success': True,
        'sent_count': sent_count,
        'failed_count': failed_count,
        'total_target': len(recipients),
        'mode': 'smtp' if is_smtp_configured() else 'simulated',
        'reminder_sent_at': now_str,
        'message': f"Reminder emails successfully sent to {sent_count} attendee(s) for {event_display_name} ({mode_label})!",
        'errors': errors[:5] if errors else []
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Findrome NMIMS Server running on port {port}")
    app.run(host='127.0.0.1', port=port, debug=True, use_reloader=False)
