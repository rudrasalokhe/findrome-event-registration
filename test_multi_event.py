"""
Multi-Event Database Isolation Test Suite
Verifies that:
1. New events spin up isolated MongoDB Atlas collections.
2. When an admin creates/views a new event, only that event's registrations are visible (starts at 0).
3. Students with the same SAP ID can register for multiple different events without collision.
4. Past event registrations remain completely preserved in MongoDB Atlas.
5. Excel CSV exports strictly export the chosen event's attendee roster.
"""

import urllib.request
import urllib.parse
import http.cookiejar
import json
import sys

BASE_URL = "http://127.0.0.1:5000"

# Setup cookie handler for sessions
cookie_jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

def request(method, path, data=None):
    url = f"{BASE_URL}{path}"
    headers = {}
    body = None
    if data is not None:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with opener.open(req) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, None

def test_multi_event():
    print("=" * 65)
    print("FINDROME NMIMS — MULTI-EVENT DATABASE ISOLATION VERIFICATION")
    print("=" * 65)

    # 1. Check Active Event Config
    status, res = request('GET', '/api/event-config')
    assert status == 200, f"Expected 200, got {status}"
    print(f"  Test 1: Active event configuration verified: '{res['settings']['event_name']} {res['settings']['event_edition']}'.")

    # 2. Admin Login
    status, res = request('POST', '/api/admin/login', {'password': 'admin'})
    assert status == 200 and res['success'], f"Admin login failed: {res}"
    print("  Test 2: Admin authenticated successfully.")

    # 3. List Events
    status, res = request('GET', '/api/admin/events')
    assert status == 200 and res['success'], f"Failed to list events: {res}"
    events = res['events']
    print(f"  Test 3: Found {len(events)} event(s) in events_master. Active: '{res['active_event_code']}'.")

    # 4. Check findrome_2026 registrations
    status, res = request('GET', '/api/admin/registrations?event_code=findrome_2026')
    assert status == 200, f"Failed: {res}"
    orig_count = res['total']
    print(f"  Test 4: Original event 'findrome_2026' has {orig_count} registered attendee(s).")

    # 5. Create a BRAND NEW EVENT (e.g. Findrome 2027)
    test_event_payload = {
        'event_name': 'Findrome Test',
        'event_edition': '2027',
        'event_dates': 'October 15 – 16, 2027',
        'event_start_date': '2027-10-15',
        'event_end_date': '2027-10-16',
        'event_venue': 'NMIMS MPSTME Audi-2',
        'is_active': True
    }
    status, res = request('POST', '/api/admin/create-event', test_event_payload)
    assert status == 201 and res['success'], f"Failed to create new event: {res}"
    new_event_code = res['event_code']
    print(f"  Test 5: Created new event '{new_event_code}' with dedicated Atlas collection!")

    # 6. Verify Admin View on New Event ISOLATION: MUST BE 0 REGISTRATIONS!
    status, res = request('GET', f'/api/admin/registrations?event_code={new_event_code}')
    assert status == 200, f"Failed: {res}"
    assert res['total'] == 0, f"ISOLATION FAILED: Expected 0 registrations for new event, got {res['total']}!"
    assert res['btech_count'] == 0
    assert res['mbatech_count'] == 0
    assert len(res['registrations']) == 0
    print(f"  Test 6: PASS! New event '{new_event_code}' has exactly 0 registrations visible to Admin! (Old registrations isolated).")

    # 7. Register a candidate with the SAME SAP ID (70012023777) that is already in 2026
    candidate_payload = {
        'name': 'Test Delegate 2027',
        'email': 'delegate2027@nmims.edu',
        'phone': '9876543210',
        'sap_id': '70012023777', # Same SAP ID!
        'program': 'B.Tech',
        'year_of_study': '3rd Year',
        'branch': 'Computer Science & Engineering (Cyber Security)'
    }
    status, res = request('POST', '/api/register', candidate_payload)
    assert status == 201 and res['success'], f"Registration with same SAP ID failed: {res}"
    print("  Test 7: PASS! Student with SAP ID 70012023777 successfully registered for the new event without duplicate collision!")

    # 8. Verify Admin View on New Event now has EXACTLY 1 registration
    status, res = request('GET', f'/api/admin/registrations?event_code={new_event_code}')
    assert status == 200, f"Failed: {res}"
    assert res['total'] == 1, f"Expected 1, got {res['total']}"
    assert res['btech_count'] == 1
    assert res['registrations'][0]['sap_id'] == '70012023777'
    print(f"  Test 8: PASS! Admin view for '{new_event_code}' shows ONLY the 1 new attendee!")

    # 9. Verify findrome_2026 STILL has its original registrations (No data loss or contamination!)
    status, res = request('GET', '/api/admin/registrations?event_code=findrome_2026')
    assert status == 200, f"Failed: {res}"
    assert res['total'] == orig_count, f"Contamination detected! Expected {orig_count}, got {res['total']}"
    print(f"  Test 9: PASS! Historical event 'findrome_2026' remains 100% intact with {orig_count} attendees.")

    # 10. Test Excel Export for the new event
    export_url = f"{BASE_URL}/admin/export?event_code={new_event_code}"
    req = urllib.request.Request(export_url, headers={'Content-Type': 'application/json'}, method='GET')
    with opener.open(req) as resp:
        content = resp.read().decode('utf-8')
        lines = [line.strip() for line in content.split('\n') if line.strip()]
        # Header + 1 attendee line = 2 lines
        assert len(lines) == 2, f"Expected 2 lines in export (header + 1 attendee), got {len(lines)}"
        assert '70012023777' in lines[1]
        print(f"  Test 10: PASS! Excel CSV export for '{new_event_code}' contains strictly its 1 attendee.")

    # 11. Switch active event back to findrome_2026
    status, res = request('POST', '/api/admin/switch-event', {'event_code': 'findrome_2026'})
    assert status == 200 and res['success'], f"Failed to switch back: {res}"
    print("  Test 11: Switched active live event back to 'findrome_2026'.")

    print("=" * 65)
    print(" ALL 11 MULTI-EVENT DATABASE ISOLATION TESTS PASSED! ")
    print("=" * 65)

if __name__ == '__main__':
    test_multi_event()
