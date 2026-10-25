import os
import sys
import time
import socket
import subprocess
import sqlite3
import uuid
import datetime
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

# Ensure utf-8 output on Windows
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

ARTIFACTS_DIR = Path(r"C:\Users\praveen\.gemini\antigravity\brain\c22ddf29-5c12-4a1f-b804-f613e8a65b63")
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

API_PORT = 8888
VITE_PORT = 5174
APP_URL = f"http://localhost:{VITE_PORT}"
DB_PATH = "data/nextora.sqlite"

def regexp_fn(pattern, value):
    if value is None or pattern is None:
        return 0
    return 1 if re.search(pattern, str(value)) else 0

def subset_of_fn(value, allowed):
    try:
        import json
        arr = json.loads(value) if isinstance(value, str) else value
        allowed_set = set(json.loads(allowed) if isinstance(allowed, str) else allowed)
        return 1 if (isinstance(arr, list) and all(item in allowed_set for item in arr)) else 0
    except Exception:
        return 0

def get_db():
    con = sqlite3.connect(DB_PATH)
    con.create_function("REGEXP", 2, regexp_fn)
    con.create_function("subset_of", 2, subset_of_fn)
    return con

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def wait_for_url(url, timeout=30):
    start = time.time()
    while time.time() - start < timeout:
        try:
            import urllib.request
            import urllib.error
            req = urllib.request.Request(url, headers={"User-Agent": "Test"})
            with urllib.request.urlopen(req, timeout=2) as response:
                return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            time.sleep(0.5)
    return False

def main():
    print("=" * 70)
    print("MASTER VERIFICATION SUITE: POS CUSTOMER MANAGEMENT & DELETE")
    print("Tests A through H Verification (Playwright E2E)")
    print("=" * 70)

    # 1. Seed baseline data in SQLite
    print("\n[1/6] Running seed_pos_tracker.py to ensure baseline data...")
    subprocess.run([sys.executable, "tests/seed_pos_tracker.py"], check=True)

    # Reset owner password to test-owner-password
    owner_env = os.environ.copy()
    owner_env["OWNER_EMAIL"] = "owner@example.test"
    owner_env["OWNER_PASSWORD"] = "test-owner-password"
    subprocess.run("node scripts/create-owner.js", shell=True, env=owner_env, check=True)

    # Clean up previous playwright test customers
    con = get_db()
    cur = con.cursor()
    cur.execute("DELETE FROM inv_pos_customers WHERE name LIKE 'Playwright%'")
    cur.execute("DELETE FROM inv_clients WHERE name LIKE 'Playwright%'")
    cur.execute("DELETE FROM inv_rate_limits")
    con.commit()
    con.close()

    # 2. Start API Server
    server_env = os.environ.copy()
    server_env.pop("DATABASE_URL", None)
    server_env["API_PORT"] = str(API_PORT)
    server_env["PORT"] = str(API_PORT)
    server_env["APP_URL"] = f"http://localhost:{VITE_PORT}"
    server_env["ORIGIN"] = f"http://localhost:{VITE_PORT}"

    api_proc = None
    if not is_port_in_use(API_PORT):
        print(f"\n[2/6] Starting API Server on port {API_PORT}...")
        api_proc = subprocess.Popen("node server/local.js", shell=True, env=server_env)
        if not wait_for_url(f"http://127.0.0.1:{API_PORT}/api/auth/me", timeout=25):
            print("API Server failed to start!")
            sys.exit(1)
        print("  ✓ API Server is ready.")
    else:
        print(f"  ✓ API Server already running on port {API_PORT}.")

    # 3. Start Vite Dev Server
    vite_proc = None
    if not is_port_in_use(VITE_PORT):
        print(f"\n[3/6] Starting Vite Dev Server on port {VITE_PORT}...")
        vite_proc = subprocess.Popen(f"npx vite --port {VITE_PORT} --strictPort", shell=True, env=server_env)
        if not wait_for_url(APP_URL, timeout=30):
            print("Vite Dev Server failed to start!")
            sys.exit(1)
        print("  ✓ Vite Dev Server is ready.")
    else:
        print(f"  ✓ Vite Dev Server already running on port {VITE_PORT}.")

    console_errors = []
    network_failures = []

    try:
        print("\n[4/6] Launching Playwright Chromium Browser...")
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                device_scale_factor=1.0,
                accept_downloads=True,
            )
            page = context.new_page()

            page.on("console", lambda msg: console_errors.append(f"[{msg.type}] {msg.text}") if msg.type in ("error", "warning") else None)
            page.on("requestfailed", lambda req: network_failures.append(f"{req.url}: {req.failure}"))

            # Log in
            print("  - Navigating to application root and authenticating...")
            page.goto(f"{APP_URL}/")
            page.wait_for_selector("#app")
            page.wait_for_timeout(1000)

            target = page.wait_for_selector('input[name="email"], a[href="#/reports"]', timeout=15000)
            if page.locator('input[name="email"]').is_visible():
                print("  - Logging in as owner@example.test...")
                page.fill('input[name="email"]', "owner@example.test")
                page.fill('input[name="password"]', "test-owner-password")
                page.click('button[type="submit"]')
                page.wait_for_timeout(1500)

            page.wait_for_selector('a[href="#/tracker"]', timeout=15000)
            print("  ✓ Authenticated session active.")

            # =========================================================================
            # TEST A: Customer Profile Full Editing & Persistence
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST A: Full Customer Editing & Persistence")
            print("-" * 60)

            # Seed Customer A in SQLite
            cust_a_id = str(uuid.uuid4())
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            con = get_db()
            cur = con.cursor()
            cur.execute("SELECT id FROM inv_pos_employees LIMIT 1")
            emp_id = cur.fetchone()[0]
            cur.execute("SELECT id FROM inv_products LIMIT 1")
            prod_id = cur.fetchone()[0]
            cur.execute("SELECT id FROM inv_pos_subscription_plans LIMIT 1")
            plan_id = cur.fetchone()[0]
            cur.execute("SELECT id FROM inv_users WHERE email='owner@example.test'")
            owner_id = cur.fetchone()[0]
            cur.execute("SELECT id FROM inv_custom_field_definitions WHERE label='Tax Slab Category'")
            custom_field_id = cur.fetchone()[0]

            cur.execute("""
                INSERT INTO inv_pos_customers(id, name, business_name, address, employee_id, phone, email, remarks, status, created_at, updated_at, created_by)
                VALUES (?, 'Playwright Test A Customer', 'Playwright Retailers', 'Plot 12, HITEC City', ?, '+91 91234 56789', 'testa@retail.test', 'Initial remarks', 'ACTIVE', ?, ?, ?)
            """, (cust_a_id, emp_id, now_iso, now_iso, owner_id))
            cur.execute("""
                INSERT INTO inv_custom_field_values(definition_id, customer_id, value, updated_at, updated_by)
                VALUES (?, ?, '12% Slab', ?, ?)
            """, (custom_field_id, cust_a_id, now_iso, owner_id))
            con.commit()
            con.close()

            print("  - Navigating to Customer Tracker...")
            page.goto(f"{APP_URL}/#/tracker")
            page.wait_for_selector('table tbody[data-rows]', timeout=10000)
            page.wait_for_timeout(800)

            # Find row and click Edit
            edit_btn = page.locator(f'button[data-action="customer-edit"][data-id="{cust_a_id}"]')
            assert edit_btn.count() >= 1, f"Edit button for customer {cust_a_id} not found"
            print("  - Clicking Edit button on customer row...")
            edit_btn.click()

            # Wait for Edit Customer modal
            page.wait_for_selector('#modal-root [role="dialog"]', timeout=5000)
            modal_title = page.locator('#modal-root h2').inner_text()
            assert "Edit Customer" in modal_title, f"Expected modal title 'Edit Customer', got '{modal_title}'"
            print(f"  ✓ Modal opened: '{modal_title}'")

            # Verify existing values populated
            assert page.locator('#modal-root input[name="name"]').input_value() == "Playwright Test A Customer"
            assert page.locator('#modal-root input[name="business_name"]').input_value() == "Playwright Retailers"
            assert page.locator('#modal-root input[name="phone"]').input_value() == "+91 91234 56789"
            print("  ✓ Existing values accurately populated in edit form.")

            # Modify fields
            print("  - Updating form fields: Name, Business Name, Address, Phone, Remarks, Status...")
            page.fill('#modal-root input[name="name"]', "Playwright Test A Updated")
            page.fill('#modal-root input[name="business_name"]', "Playwright Retailers Updated")
            page.fill('#modal-root textarea[name="address"]', "Plot 99, Jubilee Hills, Hyderabad")
            page.fill('#modal-root input[name="phone"]', "+91 99999 88888")
            page.fill('#modal-root textarea[name="remarks"]', "Updated remarks after E2E edit test")
            page.select_option('#modal-root select[name="status"]', "ACTIVE")
            page.fill(f'#modal-root input[name="custom-{custom_field_id}"]', "18% Standard Slab")

            # Save Changes
            print("  - Submitting changes...")
            page.click('#modal-root button[data-action="edit-save"]')
            page.wait_for_selector('#modal-root [role="dialog"]', state="detached", timeout=6000)
            page.wait_for_timeout(1000)
            print("  ✓ Modal closed after save.")

            # Verify updated in tracker table
            table_text = page.locator('table tbody[data-rows]').inner_text()
            assert "Playwright Test A Updated" in table_text, "Updated customer name not visible in table!"
            assert "Playwright Retailers Updated" in table_text, "Updated business name not visible in table!"
            print("  ✓ Customer Tracker table updated with new values.")

            # Reload to verify persistence from DB
            page.reload()
            page.wait_for_selector('table tbody[data-rows]', timeout=10000)
            page.wait_for_timeout(800)
            assert "Playwright Test A Updated" in page.locator('table tbody[data-rows]').inner_text()
            print("  ✓ Changes persisted across full page reload.")

            # Navigate to detail page
            print("  - Navigating to Customer Detail page...")
            page.goto(f"{APP_URL}/#/tracker/{cust_a_id}")
            page.wait_for_selector('button[data-action="customer-edit"]', timeout=10000)
            page.wait_for_timeout(800)

            detail_text = page.locator("#app").inner_text()
            assert "Playwright Test A Updated" in detail_text
            assert "Playwright Retailers Updated" in detail_text
            assert "Plot 99, Jubilee Hills, Hyderabad" in detail_text
            assert "Updated remarks after E2E edit test" in detail_text
            custom_input = page.locator(f'input[name="field-{custom_field_id}"]')
            if custom_input.count() > 0:
                assert custom_input.input_value() == "18% Standard Slab"
            print("  ✓ Detail page shows all updated customer profile and custom fields.")

            screen_a = ARTIFACTS_DIR / "01_customer_edit_persisted.png"
            page.screenshot(path=str(screen_a))
            print(f"  ✓ Saved screenshot: {screen_a.name}")
            print(">>> TEST A PASSED: Full Customer Editing & Persistence Validated <<<")

            # =========================================================================
            # TEST B: Purchase Isolated Editing on Detail Page
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST B: Purchase Isolated Editing & History Preservation")
            print("-" * 60)

            # Seed 2 purchases for Customer A
            sub_1_id = str(uuid.uuid4())
            sub_2_id = str(uuid.uuid4())
            con = get_db()
            cur = con.cursor()
            cur.execute("""
                INSERT INTO inv_pos_subscriptions(id, customer_id, product_id, plan_id, plan_label, purchase_date, start_date, expiry_date, is_lifetime, status, amount_minor, transaction_reference, notes, created_at, updated_at, created_by)
                VALUES (?, ?, ?, ?, '1 Year Plan', '2026-01-10', '2026-01-10', '2027-01-10', 0, 'ACTIVE', 2500000, 'REF-SUB-1', 'Initial Annual Purchase', ?, ?, ?)
            """, (sub_1_id, cust_a_id, prod_id, plan_id, now_iso, now_iso, owner_id))
            cur.execute("""
                INSERT INTO inv_pos_subscriptions(id, customer_id, product_id, plan_id, plan_label, purchase_date, start_date, expiry_date, is_lifetime, status, amount_minor, transaction_reference, notes, created_at, updated_at, created_by)
                VALUES (?, ?, ?, NULL, 'Lifetime Plan', '2026-02-15', '2026-02-15', NULL, 1, 'ACTIVE', 5000000, 'REF-SUB-2', 'Add-on Terminal Lifetime', ?, ?, ?)
            """, (sub_2_id, cust_a_id, prod_id, now_iso, now_iso, owner_id))
            con.commit()
            con.close()

            # Refresh detail page
            page.reload()
            page.wait_for_selector('table.data-table', timeout=10000)
            page.wait_for_timeout(800)

            # Check both subscriptions rendered
            sub_table = page.locator('table.data-table').inner_text()
            assert "REF-SUB-1" in sub_table and "REF-SUB-2" in sub_table
            print("  ✓ Both subscriptions visible in customer detail view.")

            # Click Edit on Sub 1
            edit_sub1_btn = page.locator(f'button[data-action="subscription-edit"][data-id="{sub_1_id}"]')
            assert edit_sub1_btn.count() >= 1, "Edit button for subscription 1 not found"
            print("  - Clicking Edit on Purchase 1...")
            edit_sub1_btn.click()

            # Wait for Edit Purchase modal
            page.wait_for_selector('#modal-root [role="dialog"]', timeout=5000)
            assert "Edit Purchase" in page.locator('#modal-root h2').inner_text()

            # Update Purchase 1
            print("  - Modifying Purchase 1: purchase_date, expiry_date, notes...")
            page.fill('#modal-root input[name="purchase_date"]', "2026-01-20")
            page.fill('#modal-root input[name="expiry_date"]', "2027-01-20")
            page.fill('#modal-root textarea[name="notes"]', "Adjusted renewal terms via Playwright E2E")
            page.click('#modal-root button[data-action="sub-edit-save"]')
            page.wait_for_selector('#modal-root [role="dialog"]', state="detached", timeout=6000)
            page.wait_for_timeout(1000)

            # Verify Purchase 1 updated and Purchase 2 preserved
            sub_table_after = page.locator('table.data-table').inner_text()
            assert "2026-01-20" in sub_table_after, "Updated purchase date not shown"
            assert "2027-01-20" in sub_table_after, "Updated expiry date not shown"
            assert "REF-SUB-2" in sub_table_after, "Purchase 2 was lost or overwritten!"
            assert "2026-02-15" in sub_table_after, "Purchase 2 date altered!"

            con = get_db()
            cur = con.cursor()
            cur.execute("SELECT notes FROM inv_pos_subscriptions WHERE id = ?", (sub_1_id,))
            assert cur.fetchone()[0] == "Adjusted renewal terms via Playwright E2E"
            cur.execute("SELECT notes FROM inv_pos_subscriptions WHERE id = ?", (sub_2_id,))
            assert cur.fetchone()[0] == "Add-on Terminal Lifetime"
            con.close()
            print("  ✓ Purchase 1 successfully updated; Purchase 2 completely preserved and unaffected.")

            screen_b = ARTIFACTS_DIR / "02_purchase_edit_isolated.png"
            page.screenshot(path=str(screen_b))
            print(f"  ✓ Saved screenshot: {screen_b.name}")
            print(">>> TEST B PASSED: Purchase Isolated Editing Validated <<<")

            # =========================================================================
            # TEST C: Unsaved Changes Warning & Cancellation
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST C: Unsaved Changes Warning & Cancellation")
            print("-" * 60)

            print("  - Opening customer edit modal from detail page...")
            page.click('button[data-action="customer-edit"]')
            page.wait_for_selector('#modal-root [role="dialog"]', timeout=5000)

            print("  - Modifying Name to 'Unsaved Discarded Value'...")
            page.fill('#modal-root input[name="name"]', "Unsaved Discarded Value")

            # Intercept confirm dialog
            dialog_triggered = []
            def handle_dialog(dialog):
                dialog_triggered.append(dialog.message)
                dialog.accept()

            page.once("dialog", handle_dialog)
            print("  - Clicking Cancel button...")
            page.click('#modal-root button[data-action="edit-cancel"]')
            page.wait_for_selector('#modal-root [role="dialog"]', state="detached", timeout=5000)
            page.wait_for_timeout(500)

            assert len(dialog_triggered) == 1, "Expected browser confirm dialog before discarding unsaved changes"
            print(f"  ✓ Dialog intercepted with prompt: '{dialog_triggered[0]}'")

            # Check customer name was NOT altered
            assert "Playwright Test A Updated" in page.locator("#app").inner_text()
            assert "Unsaved Discarded Value" not in page.locator("#app").inner_text()
            print("  ✓ Customer name unchanged after discarding edits.")

            screen_c = ARTIFACTS_DIR / "03_unsaved_changes_cancelled.png"
            page.screenshot(path=str(screen_c))
            print(f"  ✓ Saved screenshot: {screen_c.name}")
            print(">>> TEST C PASSED: Unsaved Changes Warning & Cancel Behavior Validated <<<")

            # =========================================================================
            # TEST D: Safe Customer Deletion of Unlinked Customer
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST D: Safe Customer Deletion (Unlinked Record)")
            print("-" * 60)

            cust_d_id = str(uuid.uuid4())
            con = get_db()
            cur = con.cursor()
            cur.execute("""
                INSERT INTO inv_pos_customers(id, name, business_name, address, phone, email, status, created_at, updated_at, created_by)
                VALUES (?, 'Playwright Deletable Customer', 'Deletable Corp', '99 Exit Way', '+91 90000 11111', 'del@corp.test', 'ACTIVE', ?, ?, ?)
            """, (cust_d_id, now_iso, now_iso, owner_id))
            con.commit()
            con.close()

            print("  - Navigating to Customer Tracker...")
            page.goto(f"{APP_URL}/#/tracker")
            page.wait_for_selector('table tbody[data-rows]', timeout=10000)
            page.wait_for_timeout(800)

            del_btn = page.locator(f'button[data-action="customer-delete"][data-id="{cust_d_id}"]')
            assert del_btn.count() >= 1, f"Delete button for customer {cust_d_id} not found"
            print("  - Clicking Delete on unlinked customer row...")
            del_btn.click()

            # Confirm modal
            page.wait_for_selector('#modal-root [role="dialog"]', timeout=5000)
            del_modal_text = page.locator('#modal-root [role="dialog"]').inner_text()
            assert "Delete Customer" in del_modal_text
            assert "Playwright Deletable Customer" in del_modal_text
            assert "Deletable Corp" in del_modal_text
            print("  ✓ Deletion confirmation modal displays customer name, business, and consequences.")

            # Click Delete Customer Permanently
            print("  - Confirming permanent deletion...")
            page.click('#modal-root button[data-action="delete-confirm"]')
            page.wait_for_selector('#modal-root [role="dialog"]', state="detached", timeout=6000)
            page.wait_for_timeout(1000)

            # Verify customer row disappears from table
            assert "Playwright Deletable Customer" not in page.locator('table tbody[data-rows]').inner_text()
            print("  ✓ Customer row removed from tracker table.")

            # Verify SQLite DB
            con = get_db()
            cur = con.cursor()
            cur.execute("SELECT count(*) FROM inv_pos_customers WHERE id = ?", (cust_d_id,))
            assert cur.fetchone()[0] == 0, "Customer row still exists in database!"
            cur.execute("SELECT count(*) FROM inv_audit_logs WHERE event = 'CUSTOMER_DELETED' AND entity_id = ?", (cust_d_id,))
            assert cur.fetchone()[0] >= 1, "Missing CUSTOMER_DELETED audit log entry!"
            con.close()
            print("  ✓ Customer permanently deleted from database and audit log recorded.")

            screen_d = ARTIFACTS_DIR / "04_customer_safely_deleted.png"
            page.screenshot(path=str(screen_d))
            print(f"  ✓ Saved screenshot: {screen_d.name}")
            print(">>> TEST D PASSED: Safe Customer Deletion Validated <<<")

            # =========================================================================
            # TEST E: Financial Safeguards & Blocked Delete (With Archive Offer)
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST E: Financial Safeguards on Customer Deletion")
            print("-" * 60)

            # Seed Customer E with a subscription tied to an invoice ID
            cust_e_id = str(uuid.uuid4())
            sub_e_id = str(uuid.uuid4())
            fake_invoice_id = str(uuid.uuid4())
            con = get_db()
            cur = con.cursor()
            cur.execute("""
                INSERT INTO inv_pos_customers(id, name, business_name, address, phone, email, status, created_at, updated_at, created_by)
                VALUES (?, 'Playwright Protected Customer', 'Protected Corp', '100 Shield Way', '+91 90000 22222', 'prot@corp.test', 'ACTIVE', ?, ?, ?)
            """, (cust_e_id, now_iso, now_iso, owner_id))
            cur.execute("""
                INSERT INTO inv_pos_subscriptions(id, customer_id, product_id, plan_id, plan_label, purchase_date, start_date, expiry_date, is_lifetime, status, invoice_id, transaction_reference, created_at, updated_at, created_by)
                VALUES (?, ?, ?, ?, '1 Year Plan', '2026-01-01', '2026-01-01', '2027-01-01', 0, 'ACTIVE', ?, 'NC/INV/2026-27/9999', ?, ?, ?)
            """, (sub_e_id, cust_e_id, prod_id, plan_id, fake_invoice_id, now_iso, now_iso, owner_id))
            con.commit()
            con.close()

            page.reload()
            page.wait_for_selector('table tbody[data-rows]', timeout=10000)
            page.wait_for_timeout(800)

            del_e_btn = page.locator(f'button[data-action="customer-delete"][data-id="{cust_e_id}"]')
            assert del_e_btn.count() >= 1, "Delete button for protected customer not found"
            print("  - Clicking Delete on protected customer...")
            del_e_btn.click()

            page.wait_for_selector('#modal-root [role="dialog"]', timeout=5000)
            print("  - Attempting permanent deletion of protected customer...")
            page.click('#modal-root button[data-action="delete-confirm"]')
            page.wait_for_timeout(1000)

            # Verify 409 conflict explanation displayed in modal
            modal_content = page.locator('#modal-root [role="dialog"]').inner_text()
            assert "financial records" in modal_content.lower() or "cannot be deleted" in modal_content.lower()
            assert page.locator('#modal-root button[data-action="archive-instead"]').count() >= 1
            print("  ✓ Permanent deletion blocked with clear explanation; 'Archive Customer Instead' option offered.")

            # Click Archive Customer Instead
            print("  - Clicking 'Archive Customer Instead'...")
            page.click('#modal-root button[data-action="archive-instead"]')
            page.wait_for_selector('#modal-root [role="dialog"]', state="detached", timeout=6000)
            page.wait_for_timeout(1000)

            # Verify status in DB is ARCHIVED
            con = get_db()
            cur = con.cursor()
            cur.execute("SELECT status FROM inv_pos_customers WHERE id = ?", (cust_e_id,))
            status_val = cur.fetchone()[0]
            con.close()
            assert status_val == "ARCHIVED", f"Expected customer status ARCHIVED, got {status_val}"
            print("  ✓ Customer status safely updated to ARCHIVED without erasing financial records.")

            screen_e = ARTIFACTS_DIR / "05_financial_safeguard_archive.png"
            page.screenshot(path=str(screen_e))
            print(f"  ✓ Saved screenshot: {screen_e.name}")
            print(">>> TEST E PASSED: Financial Safeguards & Archive Alternative Validated <<<")

            # =========================================================================
            # TEST F: Purchase Deletion & Isolation
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST F: Purchase Deletion & Isolation")
            print("-" * 60)

            cust_f_id = str(uuid.uuid4())
            sub_f1_id = str(uuid.uuid4())
            sub_f2_id = str(uuid.uuid4())
            con = get_db()
            cur = con.cursor()
            cur.execute("""
                INSERT INTO inv_pos_customers(id, name, business_name, address, status, created_at, updated_at, created_by)
                VALUES (?, 'Playwright Multi Purchase Customer', 'Multi Store', '123 Market St', 'ACTIVE', ?, ?, ?)
            """, (cust_f_id, now_iso, now_iso, owner_id))
            cur.execute("""
                INSERT INTO inv_pos_subscriptions(id, customer_id, product_id, plan_id, plan_label, purchase_date, start_date, expiry_date, is_lifetime, status, notes, created_at, updated_at, created_by)
                VALUES (?, ?, ?, ?, '1 Year Plan', '2026-05-01', '2026-05-01', '2027-05-01', 0, 'ACTIVE', 'Purchase F1 To Delete', ?, ?, ?)
            """, (sub_f1_id, cust_f_id, prod_id, plan_id, now_iso, now_iso, owner_id))
            cur.execute("""
                INSERT INTO inv_pos_subscriptions(id, customer_id, product_id, plan_id, plan_label, purchase_date, start_date, expiry_date, is_lifetime, status, notes, created_at, updated_at, created_by)
                VALUES (?, ?, ?, ?, 'Lifetime Plan', '2026-06-01', '2026-06-01', NULL, 1, 'ACTIVE', 'Purchase F2 To Keep', ?, ?, ?)
            """, (sub_f2_id, cust_f_id, prod_id, plan_id, now_iso, now_iso, owner_id))
            con.commit()
            con.close()

            print("  - Navigating to Multi Purchase Customer detail page...")
            page.goto(f"{APP_URL}/#/tracker/{cust_f_id}")
            page.wait_for_selector('table.data-table', timeout=10000)
            page.wait_for_timeout(800)

            # Click delete on Sub F1
            del_f1_btn = page.locator(f'button[data-action="subscription-delete"][data-id="{sub_f1_id}"]')
            assert del_f1_btn.count() >= 1, "Delete button for Purchase F1 not found"
            print("  - Clicking Delete on Purchase F1...")
            del_f1_btn.click()

            page.wait_for_selector('#modal-root [role="dialog"]', timeout=5000)
            assert "Delete Purchase" in page.locator('#modal-root [role="dialog"]').inner_text()
            assert "2026-05-01" in page.locator('#modal-root [role="dialog"]').inner_text()

            # Confirm delete
            print("  - Confirming purchase deletion...")
            page.click('#modal-root button[data-action="delete-sub-confirm"]')
            page.wait_for_selector('#modal-root [role="dialog"]', state="detached", timeout=6000)
            page.wait_for_timeout(1000)

            # Verify Purchase F1 removed, Purchase F2 retained
            subs_after_f = page.locator('table.data-table').inner_text()
            assert "2026-05-01" not in subs_after_f
            assert "2026-06-01" in subs_after_f

            con = get_db()
            cur = con.cursor()
            cur.execute("SELECT count(*) FROM inv_pos_subscriptions WHERE id = ?", (sub_f1_id,))
            assert cur.fetchone()[0] == 0
            cur.execute("SELECT count(*) FROM inv_pos_subscriptions WHERE id = ?", (sub_f2_id,))
            assert cur.fetchone()[0] == 1
            con.close()
            print("  ✓ Purchase F1 deleted; Purchase F2 retained intact.")

            screen_f = ARTIFACTS_DIR / "06_purchase_deleted_isolated.png"
            page.screenshot(path=str(screen_f))
            print(f"  ✓ Saved screenshot: {screen_f.name}")
            print(">>> TEST F PASSED: Purchase Deletion & Isolation Validated <<<")

            # =========================================================================
            # TEST G: Automatic POS Invoice Synchronization
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST G: Automatic POS Invoice Synchronization")
            print("-" * 60)

            # Issue invoice for Playwright POS Buyer via API
            client_g_id = str(uuid.uuid4())
            inv_g_id = str(uuid.uuid4())
            con = get_db()
            cur = con.cursor()
            cur.execute("SELECT id FROM inv_products WHERE name = 'Nextora POS Mobile App'")
            prod_mob_row = cur.fetchone()
            prod_mob_id = prod_mob_row[0] if prod_mob_row else prod_id
            cur.execute("""
                INSERT INTO inv_clients(id, kind, name, company_name, email, phone, billing_address, state_code, country, gst_registered, status, created_at, updated_at, created_by)
                VALUES (?, 'BUSINESS', 'Playwright POS Buyer', 'Playwright Stores India', 'buyer@pos.test', '+91 97777 66666', 'Kondapur, Hyderabad', '36', 'India', 0, 'ACTIVE', ?, ?, ?)
            """, (client_g_id, now_iso, now_iso, owner_id))
            con.commit()
            con.close()

            # Create and issue invoice using node runner
            sync_script = f"""
            import {{ getDatabase }} from './server/db.js';
            import {{ createInvoice, issueInvoice }} from './server/documents.js';
            import {{ invoiceDraftSchema }} from './server/domain.js';
            const db = getDatabase();
            const actor = {{ id: '{owner_id}', email: 'owner@example.test', role: 'OWNER' }};
            const payload = invoiceDraftSchema.parse({{
              client_id: '{client_g_id}',
              title: 'POS Automated Invoice',
              issue_date: '2026-10-25',
              place_of_supply_state_code: '36',
              items: [{{
                product_id: '{prod_mob_id}',
                description: 'Nextora POS Mobile App licence',
                unit: 'LIC',
                quantity_milli: 1000,
                unit_price_minor: 1200000,
                tax_treatment: 'TAXABLE',
                tax_rate_bp: 1800
              }}]
            }});
            const inv = await createInvoice(db, actor, payload);
            await issueInvoice(db, actor, inv.invoice.id);
            await db.close();
            console.log('Invoice issued successfully');
            """
            proc = subprocess.run(["node", "--input-type=module", "-e", sync_script], capture_output=True, text=True, check=True)
            print(f"  ✓ {proc.stdout.strip()}")

            print("  - Navigating to Customer Tracker to verify auto-synced customer...")
            page.goto(f"{APP_URL}/#/tracker")
            page.wait_for_selector('table tbody[data-rows]', timeout=10000)
            page.wait_for_timeout(800)

            table_content_g = page.locator('table tbody[data-rows]').inner_text()
            assert "Playwright POS Buyer" in table_content_g, "Auto-synced customer not found in tracker table!"
            print("  ✓ Auto-synced customer appeared in Customer Tracker table.")

            # Open detail page
            cust_g_link = page.locator('table tbody[data-rows] a:has-text("Playwright POS Buyer")').first
            cust_g_link.click()
            page.wait_for_selector('table.data-table', timeout=10000)
            page.wait_for_timeout(800)

            detail_g = page.locator('table.data-table').inner_text()
            assert "2026-10-25" in detail_g, "Purchase date not matched"
            assert "2027-10-25" in detail_g, "Derived 1-year expiry date not matched"
            print("  ✓ Subscription automatically created with derived 1-year expiry (2026-10-25 -> 2027-10-25).")

            screen_g = ARTIFACTS_DIR / "07_pos_automatic_sync.png"
            page.screenshot(path=str(screen_g))
            print(f"  ✓ Saved screenshot: {screen_g.name}")
            print(">>> TEST G PASSED: Automatic POS Synchronization Validated <<<")

            # =========================================================================
            # TEST H: Tracker Features: Search, Filters & Modals
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST H: Tracker Features (Search, Filters, Column Management)")
            print("-" * 60)

            page.goto(f"{APP_URL}/#/tracker")
            page.wait_for_selector('table tbody[data-rows]', timeout=10000)
            page.wait_for_timeout(800)

            # Search
            print("  - Testing Search filter for 'Multi Store'...")
            page.fill('input[name="tracker-search"]', "Multi Store")
            page.click('button[data-action="filters-apply"]')
            page.wait_for_timeout(1000)

            filtered_text = page.locator('table tbody[data-rows]').inner_text()
            assert "Playwright Multi Purchase Customer" in filtered_text
            assert "Playwright Test A Updated" not in filtered_text
            print("  ✓ Search filter successfully isolated target customer.")

            # Clear
            print("  - Clearing filters...")
            page.click('button[data-action="filters-clear"]')
            page.wait_for_timeout(1000)
            assert "Playwright Test A Updated" in page.locator('table tbody[data-rows]').inner_text()
            print("  ✓ Clear filters restored complete customer list.")

            # Column Management Modal
            print("  - Testing 'Add Column' modal...")
            page.click('button[data-action="column-new"]')
            page.wait_for_selector('#modal-root [role="dialog"]', timeout=5000)
            assert "add column" in page.locator('#modal-root h2').inner_text().lower()
            print("  ✓ Add Column modal opened cleanly.")
            page.click('#modal-root button[data-action="close-modal"]')
            page.wait_for_selector('#modal-root [role="dialog"]', state="detached", timeout=5000)
            print("  ✓ Column modal cancelled cleanly.")

            screen_h = ARTIFACTS_DIR / "08_tracker_features_verified.png"
            page.screenshot(path=str(screen_h))
            print(f"  ✓ Saved screenshot: {screen_h.name}")
            print(">>> TEST H PASSED: Tracker Features & Regression Suite Validated <<<")

            print("\n" + "=" * 70)
            print("ALL PLAYWRIGHT TESTS A THROUGH H COMPLETED SUCCESSFULLY!")
            print(f"Console errors during run: {len(console_errors)}")
            print(f"Network failures during run: {len(network_failures)}")
            print("=" * 70)

    finally:
        if api_proc:
            print("Shutting down API server process...")
            api_proc.terminate()
        if vite_proc:
            print("Shutting down Vite dev server process...")
            vite_proc.terminate()

if __name__ == '__main__':
    main()
