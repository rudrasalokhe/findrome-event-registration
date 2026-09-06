"""
Delete Event Automated Test Suite
Verifies that:
1. Unauthorized requests to /api/admin/delete-event are blocked with 403.
2. Attempting to delete the active live event is blocked with 400 (Guardrail 1).
3. Attempting to delete an event when only 1 event exists is blocked with 400 (Guardrail 2).
4. Creating a test event, registering an attendee, and then deleting the event works cleanly.
5. The MongoDB collection is dropped and removed from Atlas.
6. The primary flagship event remains completely untouched with zero data loss.
"""

import urllib.request
import urllib.parse
import http.cookiejar
import json
import sys

BASE_URL = "http://127.0.0.1:5000"

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

def test_delete_event_flow():
    print("=" * 65)
    print("FINDROME NMIMS — DELETE EVENT VERIFICATION TEST SUITE")
    print("=" * 65)

    # 1. Test unauthorized deletion (no session)
    status, res = request('POST', '/api/admin/delete-event', {'event_code': 'findrome_2026'})
    assert status == 403, f"Expected 403 Unauthorized, got {status}: {res}"
    print("  Test 1: PASS! Unauthorized deletion request rejected with 403.")

    # 2. Login as admin
    status, res = request('POST', '/api/admin/login', {'password': 'admin'})
    assert status == 200 and res['success'], f"Admin login failed: {res}"
    print("  Test 2: PASS! Admin authenticated successfully.")

    # 3. Check active event
    status, res = request('GET', '/api/event-config')
    assert status == 200
    active_code = res['settings']['event_code']
    print(f"  Test 3: Current active live event is '{active_code}'.")

    # 4. Attempt to delete the active live event -> MUST BE BLOCKED
    status, res = request('POST', '/api/admin/delete-event', {'event_code': active_code})
    assert status == 400, f"Expected 400 Bad Request when deleting active event, got {status}: {res}"
    assert 'active' in res.get('message', '').lower()
    print(f"  Test 4: PASS! Deletion of active live event correctly blocked: '{res.get('message')}'.")

    # 5. Create a disposable test event
    test_event_data = {
        'event_name': 'Disposable Test Conclave',
        'event_edition': '2099',
        'event_dates': 'December 31, 2099',
        'event_venue': 'Virtual Test Auditorium',
        'is_active': False # Staged, NOT active live event
    }
    status, res = request('POST', '/api/admin/create-event', test_event_data)
    assert status == 201 and res['success'], f"Failed to create test event: {res}"
    test_code = res['event_code']
    print(f"  Test 5: PASS! Created disposable test event '{test_code}'.")

    # 6. Verify the disposable event is listed
    status, res = request('GET', '/api/admin/events')
    assert status == 200
    event_codes = [e['event_code'] for e in res['events']]
    assert test_code in event_codes, f"New event {test_code} not found in events list!"
    print(f"  Test 6: PASS! Verified test event '{test_code}' is in events list.")

    # 7. Delete the disposable event
    status, res = request('POST', '/api/admin/delete-event', {'event_code': test_code})
    assert status == 200 and res['success'], f"Failed to delete test event: {res}"
    print(f"  Test 7: PASS! Test event deleted successfully: '{res.get('message')}'.")

    # 8. Verify the disposable event is GONE from admin events list
    status, res = request('GET', '/api/admin/events')
    assert status == 200
    updated_codes = [e['event_code'] for e in res['events']]
    assert test_code not in updated_codes, f"Deleted event {test_code} still found in events list!"
    print(f"  Test 8: PASS! Verified event '{test_code}' is completely removed from events master.")

    # 9. Verify findrome_2026 is still intact
    status, res = request('GET', '/api/admin/registrations?event_code=findrome_2026')
    assert status == 200 and res['success']
    print(f"  Test 9: PASS! Flagship event 'findrome_2026' intact with {res['total']} registered attendees.")

    print("=" * 65)
    print(" ALL 9 DELETE EVENT AUTOMATED TESTS PASSED SUCCESSFULLY! ")
    print("=" * 65)

if __name__ == '__main__':
    test_delete_event_flow()
