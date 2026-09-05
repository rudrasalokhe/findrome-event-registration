import json
import urllib.request
import urllib.parse
import http.cookiejar

BASE = 'http://127.0.0.1:5000'

def run_tests():
    print("=" * 65)
    print("FINDROME NMIMS — MONGODB ATLAS & SECURITY TEST SUITE")
    print("Testing MongoDB Atlas, Volunteer PIN Auth, Admin Excel Export")
    print("=" * 65)

    # Set up Cookie Jar for session handling
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    # Test 1: GET / (Candidate Portal) - Must NOT contain internal scanner/admin links
    resp = opener.open(f'{BASE}/')
    html = resp.read().decode('utf-8')
    assert resp.status == 200
    assert 'Volunteer Scanner' not in html, "Public page should not link to volunteer scanner!"
    assert 'Admin Console' not in html, "Public page should not link to admin console!"
    assert 'Find My Pass' in html
    print("  Test 1: Candidate Public Portal is clean & isolated (no scanner links).")

    # Test 2: Candidate Registration into MongoDB Atlas
    candidate_sap = '70012023777'
    reg_payload = {
        'name': 'Priya Sharma',
        'email': 'priya.sharma@nmims.edu',
        'phone': '9819876543',
        'sap_id': candidate_sap,
        'program': 'MBA Tech',
        'year_of_study': '2nd Year',
        'branch': 'Data Science'
    }
    req = urllib.request.Request(
        f'{BASE}/api/register',
        data=json.dumps(reg_payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        resp = opener.open(req)
        assert resp.status == 201
        res = json.loads(resp.read().decode('utf-8'))
        ticket_id = res['registration_id']
        print(f"  Test 2: Candidate registered in MongoDB Atlas. Pass ID: {ticket_id}")
    except urllib.error.HTTPError as e:
        if e.code == 409:
            # Already exists in cluster
            lookup_resp = opener.open(f'{BASE}/api/lookup?query={candidate_sap}')
            lookup_data = json.loads(lookup_resp.read().decode('utf-8'))
            ticket_id = lookup_data['data']['registration_id']
            print(f"  Test 2: Candidate already exists in MongoDB Atlas. Found Pass ID: {ticket_id}")
        else:
            raise

    # Test 3: Pass Lookup ("Find My Pass") from MongoDB
    resp = opener.open(f'{BASE}/api/lookup?query={candidate_sap}')
    assert resp.status == 200
    data = json.loads(resp.read().decode('utf-8'))
    assert data['success'] is True
    assert data['data']['name'] == 'Priya Sharma'
    assert data['data']['registration_id'] == ticket_id
    print(f"  Test 3: 'Find My Pass' retrieved candidate from MongoDB Atlas by SAP ID.")

    # Test 4: Volunteer Security - Verify unauthorized scan is blocked
    scan_req = urllib.request.Request(
        f'{BASE}/api/verify',
        data=json.dumps({'code': ticket_id}).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        opener.open(scan_req)
        assert False, "Unauthorized scan must be blocked with 403!"
    except urllib.error.HTTPError as e:
        assert e.code == 403
        print("  Test 4: Gate Security: Unauthorized scan blocked (403 Forbidden).")

    # Test 5: Volunteer Login with Wrong PIN -> Blocked
    bad_pin_req = urllib.request.Request(
        f'{BASE}/api/volunteer/login',
        data=json.dumps({'pin': '9999'}).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        opener.open(bad_pin_req)
        assert False, "Bad PIN should be rejected"
    except urllib.error.HTTPError as e:
        assert e.code == 401
        print("  Test 5: Volunteer Login: Invalid PIN rejected (401 Unauthorized).")

    # Test 6: Volunteer Login with Valid PIN ("2026") -> Succeeded
    valid_pin_req = urllib.request.Request(
        f'{BASE}/api/volunteer/login',
        data=json.dumps({'pin': '2026'}).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    resp = opener.open(valid_pin_req)
    assert resp.status == 200
    print("  Test 6: Volunteer Authenticated with PIN 2026 (Session established).")

    # Test 7: Authorized Volunteer QR Scan Verification (MongoDB status update)
    resp = opener.open(scan_req)
    assert resp.status == 200
    res = json.loads(resp.read().decode('utf-8'))
    assert res['valid'] is True
    print(f"  Test 7: Authorized Volunteer Scan: {res['message']}")

    # Test 8: Duplicate Scan Detector
    resp = opener.open(scan_req)
    assert resp.status == 200
    res = json.loads(resp.read().decode('utf-8'))
    assert res['valid'] is True
    assert res['already_checked_in'] is True
    print(f"  Test 8: Duplicate Scan Detector caught second scan attempt! Previous scan time: {res['checked_in_at']}")

    # Test 9: Admin Security - Unauthorized access to /api/admin/registrations blocked
    # Create fresh opener without admin session
    unauth_opener = urllib.request.build_opener()
    try:
        unauth_opener.open(f'{BASE}/api/admin/registrations')
        assert False, "Unauthorized admin access should return 403"
    except urllib.error.HTTPError as e:
        assert e.code == 403
        print("  Test 9: Admin Security: Unauthorized admin access blocked (403 Forbidden).")

    # Test 10: Admin Login with Valid Password ("admin")
    admin_login_req = urllib.request.Request(
        f'{BASE}/api/admin/login',
        data=json.dumps({'password': 'admin'}).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    resp = opener.open(admin_login_req)
    assert resp.status == 200
    print("  Test 10: Admin Authenticated successfully (Admin Session established).")

    # Test 11: Admin Data Query from MongoDB Atlas
    resp = opener.open(f'{BASE}/api/admin/registrations')
    assert resp.status == 200
    admin_data = json.loads(resp.read().decode('utf-8'))
    assert admin_data['total'] >= 1
    print(f"  Test 11: Admin Dashboard verified: {admin_data['checked_in']}/{admin_data['total']} Admitted on Atlas.")

    # Test 12: Admin Excel / CSV Export
    resp = opener.open(f'{BASE}/admin/export')
    assert resp.status == 200
    assert 'attachment' in resp.headers.get('Content-Disposition', '')
    csv_content = resp.read().decode('utf-8-sig') # Decode with BOM support
    lines = csv_content.strip().split('\n')
    header_line = lines[0]
    assert 'Registration ID' in header_line
    assert 'SAP ID' in header_line
    assert 'Check-In Status' in header_line
    assert len(lines) >= 2
    print(f"  Test 12: Excel CSV Export generated with {len(lines) - 1} attendee rows + header!")

    print("=" * 65)
    print(" ALL 12 MONGODB ATLAS & SECURITY TESTS PASSED! ")
    print("=" * 65)

if __name__ == '__main__':
    run_tests()
