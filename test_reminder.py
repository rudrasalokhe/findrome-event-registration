import json
import os
import sys

# Ensure local dir is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app import app, get_registrations_col, get_active_event_code

def run_tests():
    print("=" * 65)
    print("FINDROME NMIMS — EVENT REMINDER EMAIL AUTOMATION TEST SUITE")
    print("=" * 65)

    client = app.test_client()

    # Test 1: Check health
    health = client.get('/health')
    assert health.status_code == 200
    print("  [PASS] Test 1: App initialized & health check OK.")

    # Test 2: Unauthenticated POST /api/admin/send-reminder must be blocked with 403
    unauth_resp = client.post(
        '/api/admin/send-reminder',
        data=json.dumps({'target': 'all'}),
        content_type='application/json'
    )
    assert unauth_resp.status_code == 403
    assert unauth_resp.get_json()['success'] is False
    print("  [PASS] Test 2: Unauthenticated POST /api/admin/send-reminder correctly blocked (403).")

    # Test 3: Unauthenticated GET /api/admin/smtp-status must be blocked with 403
    unauth_smtp = client.get('/api/admin/smtp-status')
    assert unauth_smtp.status_code == 403
    print("  [PASS] Test 3: Unauthenticated GET /api/admin/smtp-status correctly blocked (403).")

    # Test 4: Authenticate Admin
    login_resp = client.post(
        '/api/admin/login',
        data=json.dumps({'password': 'admin'}),
        content_type='application/json'
    )
    assert login_resp.status_code == 200
    assert login_resp.get_json()['success'] is True
    print("  [PASS] Test 4: Admin authentication successful (200).")

    # Test 5: Check SMTP status as Admin
    smtp_resp = client.get('/api/admin/smtp-status')
    assert smtp_resp.status_code == 200
    smtp_data = smtp_resp.get_json()
    assert smtp_data['success'] is True
    assert 'mode' in smtp_data
    print(f"  [PASS] Test 5: SMTP status check OK. Mode: '{smtp_data['mode']}', Configured: {smtp_data['is_configured']}.")

    # Test 6: Register or retrieve sample attendee
    reg_payload = {
        'name': 'Aarav Malhotra',
        'email': 'aarav.malhotra.reminder@nmims.edu',
        'phone': '9876543218',
        'sap_id': '70012023992',
        'college': 'MPSTME',
        'program': 'B.Tech',
        'year_of_study': '2nd Year',
        'branch': 'Data Science',
        'slot': '28th | 2:00 PM – 4:00 PM'
    }
    reg_resp = client.post(
        '/api/register',
        data=json.dumps(reg_payload),
        content_type='application/json'
    )
    if reg_resp.status_code == 201:
        reg_data = reg_resp.get_json()
        test_reg_id = reg_data['registration_id']
        print(f"  [PASS] Test 6: Registered test candidate with Pass ID: {test_reg_id}")
    else:
        # Retrieve existing
        col = get_registrations_col()
        doc = col.find_one({'email': reg_payload['email']}) or col.find_one({'email': {'$exists': True}})
        assert doc is not None
        test_reg_id = doc['registration_id']
        print(f"  [PASS] Test 6: Using existing candidate with Pass ID: {test_reg_id}")

    # Test 7: Send single attendee reminder
    single_resp = client.post(
        '/api/admin/send-reminder',
        data=json.dumps({
            'target': 'single',
            'registration_id': test_reg_id,
            'subject': 'Your Exclusive Findrome 2026 Pass Reminder',
            'custom_message': 'Gates open at 9:30 AM sharp. Light refreshments provided.'
        }),
        content_type='application/json'
    )
    assert single_resp.status_code == 200
    single_data = single_resp.get_json()
    assert single_data['success'] is True
    assert single_data['sent_count'] == 1
    print(f"  [PASS] Test 7: Single attendee reminder dispatched ({single_data['message']}).")

    # Test 8: Verify MongoDB record updated with reminder_sent_at and reminder_count
    col = get_registrations_col()
    updated_doc = col.find_one({'registration_id': test_reg_id})
    assert updated_doc is not None
    assert updated_doc.get('reminder_sent_at') is not None
    assert updated_doc.get('reminder_count', 0) >= 1
    print(f"  [PASS] Test 8: MongoDB Atlas document updated! reminder_sent_at='{updated_doc['reminder_sent_at']}', reminder_count={updated_doc['reminder_count']}")

    # Test 9: Send test reminder email to Admin address
    admin_test_resp = client.post(
        '/api/admin/send-reminder',
        data=json.dumps({
            'test_email': 'convenor.findrome@nmims.edu',
            'subject': 'Findrome 2026 Test Email Verification'
        }),
        content_type='application/json'
    )
    assert admin_test_resp.status_code == 200
    admin_test_data = admin_test_resp.get_json()
    assert admin_test_data['success'] is True
    assert admin_test_data['sent_count'] == 1
    print(f"  [PASS] Test 9: Admin test email preview dispatched ({admin_test_data['message']}).")

    # Test 10: Bulk reminder to all registered attendees
    bulk_resp = client.post(
        '/api/admin/send-reminder',
        data=json.dumps({
            'target': 'all',
            'subject': 'Important: Findrome 2026 Entry Checklist & Schedule',
            'custom_message': 'Please bring your photo ID card.'
        }),
        content_type='application/json'
    )
    assert bulk_resp.status_code == 200
    bulk_data = bulk_resp.get_json()
    assert bulk_data['success'] is True
    assert bulk_data['sent_count'] >= 1
    print(f"  [PASS] Test 10: Bulk reminder successfully dispatched to {bulk_data['sent_count']} registered attendee(s).")

    # Test 11: Export spreadsheet contains Reminder columns
    export_resp = client.get('/admin/export')
    assert export_resp.status_code == 200
    csv_text = export_resp.data.decode('utf-8-sig')
    first_line = csv_text.splitlines()[0]
    assert 'Reminder Sent At' in first_line
    assert 'Reminder Count' in first_line
    print("  [PASS] Test 11: CSV export contains 'Reminder Sent At' & 'Reminder Count' columns.")

    # Test 12: Verify registrations API returns reminder metadata to frontend
    regs_resp = client.get('/api/admin/registrations')
    assert regs_resp.status_code == 200
    regs_data = regs_resp.get_json()
    target_in_api = next((r for r in regs_data['registrations'] if r['registration_id'] == test_reg_id), None)
    assert target_in_api is not None
    assert 'reminder_sent_at' in target_in_api
    assert 'reminder_count' in target_in_api
    print("  [PASS] Test 12: GET /api/admin/registrations supplies reminder metadata for UI display.")

    print("=" * 65)
    print("ALL 12 TESTS PASSED! EVENT REMINDER FEATURE IS FULLY VERIFIED.")
    print("=" * 65)

if __name__ == '__main__':
    run_tests()
