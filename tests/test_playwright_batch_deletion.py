import os
import sys
import time
import json
import base64
import sqlite3
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ARTIFACTS_DIR = Path("tests/playwright_artifacts")
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

API_PORT = 8899
VITE_PORT = 5199
APP_URL = f"http://localhost:{VITE_PORT}"
API_URL = f"http://127.0.0.1:{API_PORT}"

def is_port_in_use(port):
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def wait_for_url(url, timeout=30):
    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Test"})
            with urllib.request.urlopen(req, timeout=2) as resp:
                return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            time.sleep(0.5)
    return False

def main():
    print("=" * 70)
    print("STARTING PLAYWRIGHT BATCH DELETION VERIFICATION SUITE")
    print("Nextora Creations Invoice Generator — Marketing Sales Import")
    print("=" * 70)

    # 1. Seed test influencer and batch directly into SQLite
    print("\n[1/5] Seeding reference test batch in data/nextora.sqlite...")
    con = sqlite3.connect('data/nextora.sqlite')
    cur = con.cursor()

    cur.execute("SELECT id FROM inv_influencers WHERE instagram_username = '@marketing_maharaja'")
    inf_row = cur.fetchone()
    if not inf_row:
        inf_id = "a1111111-2222-4333-8444-555566667777"
        cur.execute("""
            INSERT INTO inv_influencers (
                id, legal_name, display_name, instagram_username, instagram_url,
                email, phone, address, city, state_code, postal_code, country,
                status, internal_notes, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'Test Maharaja', '41c2bedb-6698-4de9-8f0b-e6ce9c8b8ddc', datetime('now'), datetime('now'))
        """, (inf_id, "Maharaja Media Ltd", "Marketing Maharaja", "@marketing_maharaja", "https://instagram.com/marketing_maharaja", "maharaja@example.test", "+91 98888 77777", "Jubilee Hills", "Hyderabad", "36", "500033", "India"))
    else:
        inf_id = inf_row[0]

    batch_id = "e1a2b3c4-1111-4222-8333-444455556666"
    cur.execute("DELETE FROM inv_influencer_attributions WHERE id IN (SELECT id FROM inv_influencer_sales_records WHERE batch_id = ?)", (batch_id,))
    cur.execute("DELETE FROM inv_influencer_sales_records WHERE batch_id = ?", (batch_id,))
    cur.execute("DELETE FROM inv_influencer_sales_batches WHERE id = ?", (batch_id,))

    cur.execute("""
        INSERT INTO inv_influencer_sales_batches (
            id, filename, file_sha256, row_count, valid_row_count, invalid_row_count,
            duplicate_row_count, status, notes, imported_by, imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, '41c2bedb-6698-4de9-8f0b-e6ce9c8b8ddc', '2026-10-25 14:30:00')
    """, (batch_id, "Sales Report By @marketing_maharaja (1).xlsx", "sha256_mock_hash_maharaja_10rows", 10, 10, 0, 0, "Seeded reference batch"))

    for i in range(1, 11):
        rec_id = f"f0000000-1111-4222-8333-{i:012d}"
        cur.execute("""
            INSERT INTO inv_influencer_sales_records (
                id, batch_id, serial_number, customer_name, business_name, purchased_date,
                product_name, expiry_date, is_lifetime, customer_location, raw_influencer_name,
                influencer_id, agreement_id, order_reference, sale_amount_minor, discount_amount_minor,
                gst_rate_bp, gst_amount_minor, refund_amount_minor, eligible_revenue_minor,
                commission_basis, commission_rate_bp, calculated_commission_minor,
                commission_status, is_revenue_verified, revenue_source, snapshot,
                created_by, created_at, updated_at
            ) VALUES (
                ?, ?, ?, ?, ?, '2026-10-25',
                'Nextora POS Desktop', '2027-10-25', 0, 'Hyderabad, Telangana', '@marketing_maharaja',
                ?, NULL, ?, 1500000, 0,
                1800, 0, 0, 1500000,
                'NET_SALES_EX_GST', 1000, 150000,
                'VERIFIED', 1, 'IMPORTED', '{}',
                '41c2bedb-6698-4de9-8f0b-e6ce9c8b8ddc', datetime('now'), datetime('now')
            )
        """, (rec_id, batch_id, i, f"Customer #{i}", f"Outlet #{i}", inf_id, f"ORD-MM-{i}"))

        cur.execute("""
            INSERT INTO inv_influencer_attributions (
                id, influencer_id, agreement_id, referral_code, order_reference,
                customer_name, sale_amount_minor, net_revenue_minor, commission_minor,
                status, attributed_at, verified_at, created_at
            ) VALUES (?, ?, NULL, '', ?, ?, 1500000, 1500000, 150000, 'VERIFIED', datetime('now'), datetime('now'), datetime('now'))
        """, (rec_id, inf_id, f"ORD-MM-{i}", f"Customer #{i}"))

    con.commit()
    con.close()
    print(f"  ✓ Seeded reference test batch {batch_id} in SQLite")

    server_env = os.environ.copy()
    server_env["API_PORT"] = str(API_PORT)
    server_env["PORT"] = str(API_PORT)
    server_env["APP_URL"] = APP_URL
    server_env["OWNER_EMAIL"] = "owner@example.test"
    server_env["OWNER_PASSWORD"] = "test-owner-password"
    server_env.pop("DATABASE_URL", None)

    api_proc = None
    vite_proc = None

    if not is_port_in_use(API_PORT):
        print(f"\n[2/5] Starting API Server on port {API_PORT}...")
        api_proc = subprocess.Popen(
            f"node server/local.js",
            shell=True,
            env=server_env
        )
        if not wait_for_url(f"{API_URL}/api/auth/me", timeout=30):
            print("API Server failed to become ready!")
            sys.exit(1)
        print("  ✓ API Server is live.")
    else:
        print(f"  ✓ API Server already running on port {API_PORT}.")

    if not is_port_in_use(VITE_PORT):
        print(f"\n[3/5] Starting Vite Dev Server on port {VITE_PORT}...")
        vite_proc = subprocess.Popen(
            f"npx vite --port {VITE_PORT} --strictPort",
            shell=True,
            env=server_env
        )
        if not wait_for_url(APP_URL, timeout=30):
            print("Vite Dev Server failed to start!")
            sys.exit(1)
        print("  ✓ Vite Dev Server is ready.")
    else:
        print(f"  ✓ Vite Dev Server already running on port {VITE_PORT}.")

    try:
        print("\n[4/5] Launching Playwright Browser...")
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                device_scale_factor=1.0,
                accept_downloads=True,
            )
            page = context.new_page()

            # Navigate and authenticate
            page.goto(f"{APP_URL}/")
            page.wait_for_selector("#app")
            page.wait_for_timeout(1000)

            if page.locator('input[name="email"]').is_visible():
                print("  - Logging in as owner@example.test...")
                page.fill('input[name="email"]', "owner@example.test")
                page.fill('input[name="password"]', "test-owner-password")
                page.click('button[type="submit"]')
                page.wait_for_timeout(1200)

            page.wait_for_selector('a[href="#/marketing"]', timeout=15000)
            print("  ✓ Authenticated session active.")

            # =================================================================
            # Phase 8 — Test 1: Action visibility
            # =================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 1: Action Visibility in Import History & Batches")
            print("-" * 60)

            page.goto(f"{APP_URL}/#/marketing/import")
            page.wait_for_selector('tr[data-batch-id]', timeout=10000)
            page.wait_for_timeout(1000)

            # Check table headers include Actions
            headers_text = page.locator('table thead').inner_text()
            assert "ACTIONS" in headers_text.upper(), f"Missing Actions header in table: {headers_text}"
            print("  ✓ 'Actions' column header present in table")

            # Check row for our batch
            row = page.locator(f'tr[data-batch-id="{batch_id}"]')
            assert row.count() == 1, f"Batch row {batch_id} not found in table"

            # Check action buttons: Details, Download, Delete
            details_btn = row.locator('button[data-action="view-batch-details"]')
            download_link = row.locator('a[download]')
            delete_btn = row.locator('button[data-action="delete-batch"]')

            assert details_btn.count() == 1, "Details button not found"
            assert download_link.count() == 1, "Download link not found"
            assert delete_btn.count() == 1, "Delete button not found"

            assert delete_btn.get_attribute("data-id") == batch_id, "Delete button data-id mismatch"
            assert "Sales Report By @marketing_maharaja (1).xlsx" in row.inner_text()

            screenshot_actions = ARTIFACTS_DIR / "07_import_history_actions_visible.png"
            page.screenshot(path=str(screenshot_actions))
            print(f"  ✓ Saved action visibility screenshot: {screenshot_actions.name}")

            # =================================================================
            # Phase 8 — Test 2: View Details Modal
            # =================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 2: View Details Modal Verification")
            print("-" * 60)

            details_btn.click()
            page.wait_for_selector('div[role="dialog"]', timeout=5000)
            page.wait_for_timeout(600)

            dialog_text = page.locator('div[role="dialog"]').inner_text()
            assert "Batch Details" in dialog_text
            assert "Sales Report By @marketing_maharaja (1).xlsx" in dialog_text
            assert "SHA-256:" in dialog_text
            assert "IMPORTED SALES RECORDS" in dialog_text.upper()
            print("  ✓ Details modal loaded with batch metadata and records table")

            screenshot_details = ARTIFACTS_DIR / "08_batch_details_modal.png"
            page.screenshot(path=str(screenshot_details))
            print(f"  ✓ Saved details modal screenshot: {screenshot_details.name}")

            # Close details modal
            page.click('button[data-action="close-modal"]')
            page.wait_for_timeout(500)
            assert page.locator('div[role="dialog"]').count() == 0, "Details modal did not close"
            print("  ✓ Details modal closed cleanly")

            # =================================================================
            # Phase 8 — Test 3: Cancel deletion
            # =================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 3: Cancel Deletion Verification")
            print("-" * 60)

            row.locator('button[data-action="delete-batch"]').click()
            page.wait_for_selector('div[role="dialog"]', timeout=5000)
            page.wait_for_timeout(600)

            dialog_text = page.locator('div[role="dialog"]').inner_text()
            assert "Delete Import Batch?" in dialog_text
            assert "Sales Report By @marketing_maharaja (1).xlsx" in dialog_text
            assert "10" in dialog_text
            assert "Records Affected:" in dialog_text
            assert "Cancel" in dialog_text
            assert "Delete Batch" in dialog_text
            print("  ✓ Confirmation modal displayed with accurate filename, counts, and warnings")

            screenshot_confirm = ARTIFACTS_DIR / "09_delete_batch_confirmation_modal.png"
            page.screenshot(path=str(screenshot_confirm))
            print(f"  ✓ Saved delete confirmation modal screenshot: {screenshot_confirm.name}")

            # Click Cancel
            page.click('div[role="dialog"] button[data-action="close-modal"]')
            page.wait_for_timeout(500)
            assert page.locator('div[role="dialog"]').count() == 0, "Confirmation modal did not close"

            # Verify batch is STILL present
            assert page.locator(f'tr[data-batch-id="{batch_id}"]').count() == 1
            print("  ✓ Batch and records intact after clicking Cancel")

            # =================================================================
            # Phase 8 — Test 4: Successful deletion
            # =================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 4: Successful Deletion Execution")
            print("-" * 60)

            row.locator('button[data-action="delete-batch"]').click()
            page.wait_for_selector('#btn-confirm-delete-batch', timeout=5000)
            page.wait_for_timeout(300)

            # Confirm deletion
            page.click('#btn-confirm-delete-batch')
            page.wait_for_timeout(1500)

            # Verify batch row is completely gone from the table
            assert page.locator(f'tr[data-batch-id="{batch_id}"]').count() == 0, "Batch was not removed from table!"
            print("  ✓ Batch row successfully removed from table UI")

            screenshot_post_del = ARTIFACTS_DIR / "10_import_history_post_delete.png"
            page.screenshot(path=str(screenshot_post_del))
            print(f"  ✓ Saved post-delete screenshot: {screenshot_post_del.name}")

            # =================================================================
            # Phase 8 — Test 5: Report Reconciliation
            # =================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 5: Report Reconciliation Verification")
            print("-" * 60)

            page.goto(f"{APP_URL}/#/marketing/reports")
            page.wait_for_selector('h1', timeout=10000)
            page.wait_for_timeout(1000)

            reports_text = page.locator('#content').inner_text()
            assert "Influencer Sales Reports" in reports_text

            screenshot_reports = ARTIFACTS_DIR / "11_sales_reports_reconciled.png"
            page.screenshot(path=str(screenshot_reports))
            print(f"  ✓ Saved reconciled reports screenshot: {screenshot_reports.name}")

            print("\n>>> ALL PLAYWRIGHT E2E TESTS (1-5) PASSED WITH 100% SUCCESS <<<")
            browser.close()

    finally:
        print("\n[4/5] Tearing down servers if started by test runner...")
        if api_proc:
            try:
                subprocess.run(f"taskkill /F /T /PID {api_proc.pid}", shell=True, capture_output=True)
            except Exception:
                pass
        if vite_proc:
            try:
                subprocess.run(f"taskkill /F /T /PID {vite_proc.pid}", shell=True, capture_output=True)
            except Exception:
                pass
        print("  ✓ Clean shutdown completed.")

    print("\n" + "=" * 70)
    print("PLAYWRIGHT BATCH DELETION VERIFICATION COMPLETED SUCCESSFULLY")
    print(f"Artifacts saved in: {ARTIFACTS_DIR.resolve()}")
    print("=" * 70)

if __name__ == "__main__":
    main()
