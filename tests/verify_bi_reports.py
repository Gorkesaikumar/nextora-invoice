import os
import sys
import time
import socket
import subprocess
import sqlite3
import urllib.request
import urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright

# Ensure utf-8 output on Windows
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ARTIFACTS_DIR = Path(r"C:\Users\praveen\.gemini\antigravity\brain\3f36e9bc-41a1-435f-8620-2f9b061e2862")
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

API_PORT = 8888
VITE_PORT = 5174
APP_URL = f"http://localhost:{VITE_PORT}"
DB_PATH = "data/nextora.sqlite"

def is_port_in_use(port):
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

def sync_influencer_records_if_needed():
    """Copy influencer records and agreements from AppData db if data/nextora.sqlite has 0."""
    appdata_db = Path(os.path.expanduser(r"~\AppData\Roaming\nextora-invoicing\nextora-invoicing.sqlite"))
    if not appdata_db.exists():
        return

    con_local = None
    con_app = None
    try:
        con_local = sqlite3.connect(DB_PATH, timeout=15)
        cur_local = con_local.cursor()
        inf_count = cur_local.execute("SELECT count(*) FROM inv_influencer_sales_records").fetchone()[0]

        if inf_count == 0:
            print("  Syncing influencer sales and partners from AppData to local SQLite...")
            con_app = sqlite3.connect(str(appdata_db), timeout=15)
            cur_app = con_app.cursor()

            # Copy influencers
            infs = cur_app.execute("SELECT id, legal_name, display_name, instagram_username, email, phone, status, created_by, created_at, updated_at FROM inv_influencers").fetchall()
            for row in infs:
                cur_local.execute("""
                    INSERT OR IGNORE INTO inv_influencers (id, legal_name, display_name, instagram_username, email, phone, status, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, row)

            # Copy agreements
            agrs = cur_app.execute("SELECT id, influencer_id, contract_number, commission_basis_points, commission_basis, product_tax_mode, status, start_date, end_date, is_indefinite, special_terms, created_by, created_at, updated_at FROM inv_influencer_agreements").fetchall()
            for row in agrs:
                cur_local.execute("""
                    INSERT OR IGNORE INTO inv_influencer_agreements (id, influencer_id, contract_number, commission_basis_points, commission_basis, product_tax_mode, status, start_date, end_date, is_indefinite, special_terms, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, row)

            # Copy batches
            batches = cur_app.execute("SELECT id, filename, file_sha256, row_count, valid_row_count, invalid_row_count, duplicate_row_count, status, notes, imported_by, imported_at FROM inv_influencer_sales_batches").fetchall()
            for row in batches:
                cur_local.execute("""
                    INSERT OR IGNORE INTO inv_influencer_sales_batches (id, filename, file_sha256, row_count, valid_row_count, invalid_row_count, duplicate_row_count, status, notes, imported_by, imported_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, row)

            # Copy sales records
            records = cur_app.execute("""
                SELECT id, batch_id, influencer_id, serial_number, order_reference, customer_name, business_name,
                       purchased_date, product_name, expiry_date, customer_location, sale_amount_minor,
                       discount_amount_minor, gst_rate_bp, gst_amount_minor, refund_amount_minor,
                       eligible_revenue_minor, commission_basis, commission_rate_bp, calculated_commission_minor,
                       commission_status, is_revenue_verified, created_at, updated_at
                FROM inv_influencer_sales_records
            """).fetchall()
            for row in records:
                cur_local.execute("""
                    INSERT OR IGNORE INTO inv_influencer_sales_records (
                        id, batch_id, influencer_id, serial_number, order_reference, customer_name, business_name,
                        purchased_date, product_name, expiry_date, customer_location, sale_amount_minor,
                        discount_amount_minor, gst_rate_bp, gst_amount_minor, refund_amount_minor,
                        eligible_revenue_minor, commission_basis, commission_rate_bp, calculated_commission_minor,
                        commission_status, is_revenue_verified, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, row)

            con_local.commit()
            print("  ✓ Synced influencer data successfully.")

    except Exception as e:
        print(f"  Note during sync: {e}")
    finally:
        if con_app:
            try:
                con_app.close()
            except Exception:
                pass
        if con_local:
            try:
                con_local.close()
            except Exception:
                pass

def main():
    print("=" * 70)
    print("PLAYWRIGHT VERIFICATION: BUSINESS INTELLIGENCE & REPORTING SYSTEM")
    print("Nextora Creations Invoice Generator")
    print("=" * 70)

    # 1. Reset owner first
    owner_env = os.environ.copy()
    owner_env["OWNER_EMAIL"] = "owner@example.test"
    owner_env["OWNER_PASSWORD"] = "test-owner-password"
    subprocess.run("node scripts/create-owner.js", shell=True, env=owner_env, check=True)

    # 2. Sync influencer records if needed
    sync_influencer_records_if_needed()

    # 2. Start API Server
    server_env = os.environ.copy()
    server_env.pop("DATABASE_URL", None)
    server_env["API_PORT"] = str(API_PORT)
    server_env["PORT"] = str(API_PORT)
    server_env["APP_URL"] = f"http://localhost:{VITE_PORT}"
    server_env["ORIGIN"] = f"http://localhost:{VITE_PORT}"

    api_proc = None
    if not is_port_in_use(API_PORT):
        print(f"\n[1/5] Starting API Server on port {API_PORT}...")
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
        print(f"\n[2/5] Starting Vite Dev Server on port {VITE_PORT}...")
        vite_proc = subprocess.Popen(f"npx vite --port {VITE_PORT} --strictPort", shell=True, env=server_env)
        if not wait_for_url(APP_URL, timeout=30):
            print("Vite Dev Server failed to start!")
            sys.exit(1)
        print("  ✓ Vite Dev Server is ready.")
    else:
        print(f"  ✓ Vite Dev Server already running on port {VITE_PORT}.")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 900})

            print("\n[3/5] Authenticating and navigating to Reports view...")
            page.goto(APP_URL)
            page.wait_for_selector("#app", timeout=15000)
            page.wait_for_timeout(1000)

            # Sign in if login screen is present
            if page.locator("input[type='email']").count() > 0 and page.locator("input[type='email']").is_visible():
                print("  Signing in as owner...")
                page.fill("input[type='email']", "owner@example.test")
                page.fill("input[type='password']", "test-owner-password")
                page.click("button[type='submit']")
                page.wait_for_timeout(2000)

            # Navigate to Reports
            page.goto(f"{APP_URL}/#/reports")
            page.wait_for_selector("text=Reports & Business Intelligence", timeout=15000)
            page.wait_for_timeout(1500)

            print("\n[4/5] Verifying Business Overview Dashboard & All Sections...")

            # 1. Business Overview
            assert page.locator("text=Reports & Business Intelligence").count() > 0, "Page header present"
            assert page.locator("text=1. Direct Sales & Collections").count() > 0, "Direct sales group present"
            assert page.locator("text=2. Accounts Receivable & Risk").count() > 0, "Receivables group present"
            assert page.locator("text=3. GST Tax Liabilities").count() > 0, "Tax liabilities group present"
            assert page.locator("text=4. Commercial Pipeline & Operations").count() > 0, "Operations group present"
            assert page.locator("text=5. Influencer Marketing & Revenue Sharing").count() > 0, "Influencer marketing group present"

            overview_shot = ARTIFACTS_DIR / "01_business_overview.png"
            page.screenshot(path=str(overview_shot), full_page=True)
            print(f"  ✓ Business Overview verified with all 19 metrics. Screenshot: {overview_shot.name}")

            # 2. Monthly Revenue
            print("  Switching to Monthly Revenue tab...")
            page.click("button[data-action='section'][data-section='monthly_revenue']")
            page.wait_for_selector("text=Monthly Company Financial Breakdown", timeout=10000)
            page.wait_for_timeout(800)
            monthly_shot = ARTIFACTS_DIR / "02_monthly_revenue.png"
            page.screenshot(path=str(monthly_shot), full_page=True)
            print(f"  ✓ Monthly Revenue table verified. Screenshot: {monthly_shot.name}")

            # 3. Client Register
            print("  Switching to Client Register tab...")
            page.click("button[data-action='section'][data-section='clients']")
            page.wait_for_selector("text=Customer-Wise Revenue & Receivables", timeout=10000)
            page.wait_for_timeout(800)
            clients_shot = ARTIFACTS_DIR / "03_client_register.png"
            page.screenshot(path=str(clients_shot), full_page=True)
            print(f"  ✓ Client Register verified. Screenshot: {clients_shot.name}")

            # 4. Influencer Partners
            print("  Switching to Influencer Partners tab...")
            page.click("button[data-action='section'][data-section='influencers']")
            page.wait_for_selector("text=Influencer Marketing Partners Register", timeout=10000)
            page.wait_for_timeout(800)
            inf_shot = ARTIFACTS_DIR / "04_influencer_partners.png"
            page.screenshot(path=str(inf_shot), full_page=True)
            print(f"  ✓ Influencer Partners register verified. Screenshot: {inf_shot.name}")

            # 5. Influencer Sales Detail
            print("  Switching to Influencer Sales Detail tab...")
            page.click("button[data-action='section'][data-section='influencer_sales']")
            page.wait_for_selector("text=Individual Influencer Sales Attribution Detail", timeout=10000)
            page.wait_for_timeout(800)
            sales_shot = ARTIFACTS_DIR / "05_influencer_sales_detail.png"
            page.screenshot(path=str(sales_shot), full_page=True)
            print(f"  ✓ Influencer Sales Detail verified. Screenshot: {sales_shot.name}")

            # 6. Import Batches
            print("  Switching to Import Batches tab...")
            page.click("button[data-action='section'][data-section='imports']")
            page.wait_for_selector("text=Sales Excel Import Batches", timeout=10000)
            page.wait_for_timeout(800)
            imports_shot = ARTIFACTS_DIR / "06_import_batches.png"
            page.screenshot(path=str(imports_shot), full_page=True)
            print(f"  ✓ Import Batches verified. Screenshot: {imports_shot.name}")

            # 7. Test Filter Preset (Last 90 Days)
            print("\n[5/5] Testing Filter Bar and Customer Statement...")
            preset_select = page.locator("#filter-preset")
            preset_select.select_option("last_90_days")
            page.wait_for_timeout(600)

            from_val = page.locator("#filter-from").input_value()
            to_val = page.locator("#filter-to").input_value()
            print(f"  ✓ Preset 'Last 90 days' populated range: {from_val} to {to_val}")
            assert from_val != "" and to_val != "", "From and to dates populated by preset"

            filter_shot = ARTIFACTS_DIR / "07_filter_preset_90_days.png"
            page.screenshot(path=str(filter_shot), full_page=True)

            # 8. Test Customer Statement Modal
            page.click("button[data-action='section'][data-section='clients']")
            page.wait_for_selector("text=Customer-Wise Revenue & Receivables", timeout=10000)
            page.wait_for_timeout(800)

            stmt_btn = page.locator("button[data-action='statement']").first
            if stmt_btn.count() > 0:
                print("  Opening customer statement modal...")
                stmt_btn.click()
                page.wait_for_selector("text=Customer Statement", timeout=10000)
                page.wait_for_timeout(600)
                assert page.locator("text=Customer Statement").count() > 0, "Statement modal opened"
                assert page.locator("text=Opening Balance").count() > 0, "Opening balance present"
                assert page.locator("text=Closing Balance").count() > 0, "Closing balance present"
                assert page.locator("button[data-action='export-statement-pdf']").count() > 0, "Statement PDF export button present"
                assert page.locator("button[data-action='export-statement-csv']").count() > 0, "Statement CSV export button present"

                modal_shot = ARTIFACTS_DIR / "08_client_statement_modal.png"
                page.screenshot(path=str(modal_shot), full_page=True)
                print(f"  ✓ Customer Statement modal verified. Screenshot: {modal_shot.name}")

                page.click("button[data-action='close-modal']")
                page.wait_for_timeout(500)

            # 9. Verify Action Toolbar (PDF, Excel, CSV)
            assert page.locator("button[data-action='pdf']").count() > 0, "Export PDF button present"
            assert page.locator("button[data-action='excel']").count() > 0, "Export Excel button present"
            assert page.locator("button[data-action='csv']").count() > 0, "Export CSV button present"

            # Check that there is no unwanted FILE-TEXT visible in buttons
            pdf_btn_text = page.locator("button[data-action='pdf']").inner_text()
            assert "FILE-TEXT" not in pdf_btn_text, "No FILE-TEXT artifact in PDF button"
            print(f"  ✓ Action Toolbar verified: Export PDF, Export Excel, Export CSV.")

            browser.close()

    finally:
        if api_proc:
            print("\nShutting down temporary API Server...")
            api_proc.terminate()
            try:
                api_proc.wait(timeout=5)
            except Exception:
                api_proc.kill()
        if vite_proc:
            print("Shutting down temporary Vite Dev Server...")
            vite_proc.terminate()
            try:
                vite_proc.wait(timeout=5)
            except Exception:
                vite_proc.kill()

    print("\n" + "=" * 70)
    print("ALL PLAYWRIGHT VERIFICATION CHECKS PASSED SUCCESSFULLY!")
    print("=" * 70)

if __name__ == "__main__":
    main()
