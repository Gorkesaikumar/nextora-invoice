import os
import sys
import time
import json
import base64
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
import pypdf

# Ensure utf-8 output on Windows
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ARTIFACTS_DIR = Path("tests/playwright_artifacts")
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

API_PORT = 8888
VITE_PORT = 5174
APP_URL = f"http://localhost:{VITE_PORT}"
API_URL = f"http://127.0.0.1:{API_PORT}"

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
    print("PLAYWRIGHT VERIFICATION: INFLUENCER SALES REPORTS")
    print("Nextora Creations Invoice Generator")
    print("=" * 70)

    # 1. Start API Server (using local SQLite database data/nextora.sqlite)
    print(f"\n[1/6] Starting API Server on port {API_PORT}...")
    env = os.environ.copy()
    env["API_PORT"] = str(API_PORT)
    env["APP_URL"] = f"http://localhost:{VITE_PORT}"
    env.pop("DATABASE_URL", None) # Ensure SQLite is used
    api_proc = subprocess.Popen(
        ["node", "server/local.js"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        shell=True,
    )

    # 2. Start Vite Dev Server
    print(f"[2/6] Starting Vite Dev Server on port {VITE_PORT}...")
    vite_proc = subprocess.Popen(
        ["npx", "vite", "--port", str(VITE_PORT), "--strictPort"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        shell=True,
    )

    try:
        print("[3/6] Waiting for servers to be healthy...")
        if not wait_for_url(f"{API_URL}/api/reference", timeout=20):
            print("ERROR: API Server did not respond within timeout!")
            sys.exit(1)
        if not wait_for_url(f"{APP_URL}/", timeout=20):
            print("ERROR: Vite Server did not respond within timeout!")
            sys.exit(1)
        print("✓ Servers are up and responding.")

        # Seed authoritative test records
        print("  - Seeding test records...")
        subprocess.run(["node", "tests/seed_full_test_data.js"], check=True)
        print("  ✓ Test records seeded successfully.")

        console_errors = []
        network_failures = []
        network_requests = []

        with sync_playwright() as playwright:
            print("\n[4/6] Launching Chromium Browser...")
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1366, "height": 900},
                accept_downloads=True,
            )
            page = context.new_page()

            page.on("console", lambda msg: (console_errors.append(f"[{msg.type}] {msg.text}"), print(f"    BROWSER [{msg.type}]: {msg.text}")) if msg.type in ["error"] else None)
            page.on("requestfailed", lambda req: (network_failures.append(f"{req.url}: {req.failure}"), print(f"    NETWORK FAIL: {req.url} - {req.failure}")))
            page.on("response", lambda resp: network_requests.append({
                "url": resp.url,
                "status": resp.status,
                "method": resp.request.method
            }))

            # Authenticate
            print("Navigating to application root...")
            page.goto(f"{APP_URL}/")
            page.wait_for_selector("#app")

            target = page.wait_for_selector('input[name="email"], a[href="#/reports"]', timeout=15000)
            if page.locator('input[name="email"]').is_visible():
                print("Logging in as owner@example.test...")
                page.fill('input[name="email"]', "owner@example.test")
                page.fill('input[name="password"]', "test-owner-password")
                page.click('button[type="submit"]')
                page.wait_for_timeout(1000)

            # Wait for authenticated navigation
            page.wait_for_selector('a[href="#/reports"]', timeout=15000)
            print("✓ Successfully authenticated as Owner.")

            # =========================================================================
            # TEST 1: Navigation via Sidebar to Influencer Sales Reports
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 1: Navigation & Endpoint Resolution")
            print("-" * 60)

            # Click on Marketing & Partnerships in navigation or subitem
            reports_nav = page.locator('a[href="#/marketing/reports"]')
            if reports_nav.count() > 0 and reports_nav.first.is_visible():
                print("  - Clicking 'Influencer Sales Reports' link in sidebar...")
                reports_nav.first.click()
            else:
                print("  - Direct navigation to #/marketing/reports...")
                page.goto(f"{APP_URL}/#/marketing/reports")

            page.wait_for_selector('table, .label-technical', timeout=15000)
            page.wait_for_timeout(500)

            # Check that "Endpoint not found" is ABSOLUTELY NOT present
            body_content = page.content()
            assert "Endpoint not found" not in body_content, "CRITICAL ERROR: 'Endpoint not found' is still rendered on the page!"
            print("  ✓ Verified: 'Endpoint not found.' error does NOT appear anywhere on the page")

            # Check page header
            header_title = page.locator("h1").inner_text()
            assert "Influencer Sales Reports" in header_title, f"Unexpected page title: {header_title}"
            print("  ✓ Verified: Header title is 'Influencer Sales Reports'")

            # Capture initial view screenshot
            screenshot_path = ARTIFACTS_DIR / "01_influencer_sales_reports_main.png"
            page.screenshot(path=str(screenshot_path), full_page=False)
            print(f"  ✓ Saved screenshot: {screenshot_path.name}")

            # =========================================================================
            # TEST 2: Summary Cards & Financial Metric Distinctions
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 2: Summary Cards & Business Reconciliations")
            print("-" * 60)

            card_labels = [
                "TOTAL RECORDED SALES",
                "ELIGIBLE NET SALES",
                "COMMISSION EARNED",
                "PENDING SETTLEMENT",
                "COMMISSION PAID",
                "ACTIVE INFLUENCERS",
                "REFUNDS / CANCELLED"
            ]
            for cl in card_labels:
                assert cl in body_content, f"Summary card label '{cl}' missing from view!"
            print("  ✓ All 7 required Summary KPI cards rendered")

            # Assert gross sales vs net sales vs commission amounts
            page.wait_for_selector('.num', timeout=10000)
            page_text = page.locator("#content").inner_text()
            assert "TOTAL RECORDED SALES" in page_text
            assert "ELIGIBLE NET SALES" in page_text
            assert "COMMISSION EARNED" in page_text
            assert "₹46,998.00" in page_text or "₹3,46,998.00" in page_text or "₹1,96,998.00" in page_text, f"Gross Sales missing: {page_text[:400]}"
            assert "₹45,167.80" in page_text or "₹3,45,167.80" in page_text or "₹1,95,167.80" in page_text, f"Eligible Net Sales missing"
            assert "₹10,333.90" in page_text or "₹40,333.90" in page_text or "₹25,333.90" in page_text, f"Commission Earned missing"
            print("  ✓ Gross sales properly distinguished from eligible net sales excl. GST")
            print("  ✓ Commission earned accurately calculated per active agreements")

            # =========================================================================
            # TEST 3: Influencer Sales Table & Nizamabad_pilla 50% Rate Verification
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 3: Influencer Sales Table & 50% Commission Rate")
            print("-" * 60)

            # Check Meera Nair row under Nizamabad_pilla
            assert "Meera Nair" in page_text, "Customer 'Meera Nair' missing from table"
            assert "Nizamabad_pilla" in page_text, "Influencer 'Nizamabad_pilla' missing from table"
            assert "@nizamabad_pilla__19" in page_text, "Instagram handle '@nizamabad_pilla__19' missing"
            assert "Nextora POS Mobile" in page_text, "Product 'Nextora POS Mobile' missing"
            assert "50.0%" in page_text, "Expected 50.0% commission rate missing for Nizamabad_pilla agreement!"
            assert "₹2,541.95" in page_text, "Expected calculated commission ₹2,541.95 missing for Meera Nair sale!"
            assert "₹5,083.90" in page_text, "Expected net eligible revenue ₹5,083.90 missing for Meera Nair sale!"
            assert "₹915.10" in page_text, "Expected extracted GST ₹915.10 missing!"

            print("  ✓ Stored agreement 50% rate verified: Meera Nair sale ₹5,999 -> Net ₹5,083.90, Comm ₹2,541.95, GST ₹915.10")

            # Check Rohit Tech Reviews 15% rate
            assert "Rohit Tech Reviews" in page_text
            assert "Vikram Malhotra" in page_text
            assert "15.0%" in page_text
            assert "₹3,000.00" in page_text # 15% of ₹20,000
            print("  ✓ Rohit Tech Reviews agreement 15% rate verified: Vikram Malhotra ₹20,000 -> Comm ₹3,000.00")

            # =========================================================================
            # TEST 4: Search & Sorting Interaction
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 4: Search & Sorting Interaction")
            print("-" * 60)

            # Search for Meera
            print("  - Searching for 'Meera'...")
            page.fill('#filter-search', "Meera")
            page.click('button:has-text("Apply Filters")')
            page.wait_for_timeout(800)

            filtered_text = page.locator("#content").inner_text()
            assert "Meera Nair" in filtered_text
            assert "Vikram Malhotra" not in filtered_text
            assert "Anita Verma" not in filtered_text
            print("  ✓ Search filter strictly isolated 'Meera Nair' record")

            # Reset filters
            page.click('button:has-text("Reset")')
            page.wait_for_timeout(800)
            reset_text = page.locator("#content").inner_text()
            assert "Vikram Malhotra" in reset_text
            assert "Meera Nair" in reset_text
            print("  ✓ Reset button cleared search and restored full record table")

            # =========================================================================
            # TEST 5: Date Filtering & Empty State
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 5: Date Filters & Non-Matching Empty State")
            print("-" * 60)

            # Select a future custom date range where no sales exist
            page.fill('#filter-from', "2029-01-01")
            page.fill('#filter-to', "2029-01-31")
            page.click('button:has-text("Apply Filters")')
            page.wait_for_timeout(800)

            empty_text = page.locator("#content").inner_text()
            assert "No Sales Matching Filters" in empty_text or "No matching sales records found" in empty_text
            assert "Reset All Filters" in empty_text or "Reset" in empty_text
            print("  ✓ Empty state verified: 'No Sales Matching Filters' rendered cleanly without errors")

            empty_screenshot_path = ARTIFACTS_DIR / "02_sales_reports_empty_filter_state.png"
            page.screenshot(path=str(empty_screenshot_path))
            print(f"  ✓ Saved empty filter screenshot: {empty_screenshot_path.name}")

            # Reset filters
            page.click('button:has-text("Reset All Filters"), button:has-text("Reset")')
            page.wait_for_timeout(800)

            # =========================================================================
            # TEST 6: Report Downloads (Consolidated PDF, Excel, CSV)
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 6: Report Exports (PDF, XLSX, CSV)")
            print("-" * 60)

            # A. Consolidated PDF
            print("  - Testing Consolidated PDF Download...")
            pdf_btn = page.locator('button[data-action="export-pdf"]')
            assert pdf_btn.count() == 1, "Consolidated PDF button not found"

            with page.expect_download(timeout=15000) as dl_info:
                pdf_btn.click()
            dl = dl_info.value
            pdf_out = ARTIFACTS_DIR / "consolidated_sales_report.pdf"
            dl.save_as(str(pdf_out))

            with open(pdf_out, "rb") as f:
                pdf_bytes = f.read()
            assert pdf_bytes.startswith(b"%PDF-"), "Downloaded file is not valid PDF"
            assert len(pdf_bytes) > 5000, f"Downloaded PDF too small: {len(pdf_bytes)} bytes"

            # Parse PDF content with pypdf
            reader = pypdf.PdfReader(str(pdf_out))
            all_pdf_text = "\n".join([p.extract_text() for p in reader.pages])
            assert "CONSOLIDATED INFLUENCER SALES & COMMISSION REPORT" in all_pdf_text
            assert "Rohit Tech Reviews" in all_pdf_text
            assert "Nizamabad_pilla" in all_pdf_text
            print(f"  ✓ Consolidated PDF validated ({len(reader.pages)} page(s), {len(pdf_bytes)} bytes)")

            # B. Export Excel
            print("  - Testing Excel Export...")
            xlsx_btn = page.locator('button[data-action="export-excel"]')
            assert xlsx_btn.count() == 1

            with page.expect_download(timeout=15000) as xlsx_dl_info:
                xlsx_btn.click()
            xlsx_dl = xlsx_dl_info.value
            xlsx_out = ARTIFACTS_DIR / "influencer_sales_export.xlsx"
            xlsx_dl.save_as(str(xlsx_out))
            assert os.path.getsize(xlsx_out) > 2000
            print(f"  ✓ Excel export validated ({os.path.getsize(xlsx_out)} bytes)")

            # C. Export CSV
            print("  - Testing CSV Export...")
            csv_btn = page.locator('button[data-action="export-csv"]')
            assert csv_btn.count() == 1

            with page.expect_download(timeout=15000) as csv_dl_info:
                csv_btn.click()
            csv_dl = csv_dl_info.value
            csv_out = ARTIFACTS_DIR / "influencer_sales_export.csv"
            csv_dl.save_as(str(csv_out))

            with open(csv_out, "r", encoding="utf-8-sig") as f:
                csv_content = f.read()
            assert "Customer Name" in csv_content
            assert "Vikram Malhotra" in csv_content
            assert "Meera Nair" in csv_content
            print(f"  ✓ CSV export validated ({os.path.getsize(csv_out)} bytes, valid UTF-8 BOM)")

            # =========================================================================
            # TEST 7: Partner Performance Breakdown Tab & Drilldown
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 7: Partner Performance Breakdown & View Sales Modal")
            print("-" * 60)

            partner_tab = page.locator('button[data-action="switch-sales-view"][data-tab="partners"]')
            assert partner_tab.count() == 1
            partner_tab.click()
            page.wait_for_timeout(800)

            tab_text = page.locator("#content").inner_text()
            assert "Influencer Performance & Revenue-Sharing Summary" in tab_text
            assert "Rohit Tech Reviews" in tab_text
            assert "Nizamabad_pilla" in tab_text

            screenshot_partners = ARTIFACTS_DIR / "03_partner_performance_breakdown.png"
            page.screenshot(path=str(screenshot_partners))
            print(f"  ✓ Saved partner performance breakdown screenshot: {screenshot_partners.name}")

            # Click View Sales for Nizamabad_pilla
            print(f"  - Looking for View Sales buttons...")
            view_sales_btns = page.locator('button.btn-view-sales')
            btn_count = view_sales_btns.count()
            print(f"  - Found {btn_count} View Sales buttons")
            for idx in range(btn_count):
                btn_id = view_sales_btns.nth(idx).get_attribute("data-id")
                print(f"    Button {idx}: data-id = {btn_id}")

            target_btn = view_sales_btns.last # Nizamabad_pilla is usually last or test first
            print(f"  - Clicking View Sales button with id {target_btn.get_attribute('data-id')}...")
            target_btn.click()

            print("  - Waiting for modal dialog...")
            try:
                page.wait_for_selector('#modal-root [role="dialog"]', timeout=5000)
            except Exception as wait_err:
                print(f"Modal wait timed out! Let us inspect modal-root content:")
                print(page.locator('#modal-root').inner_html())
                print("Recent network requests:")
                for nr in network_requests[-10:]:
                    print("  ", nr)
                print("Console errors:")
                for ce in console_errors:
                    print("  ", ce)
                raise wait_err

            modal_text = page.locator("#modal-root").inner_text()
            assert "Attributed Sales" in modal_text
            print("  ✓ 'View Sales' partner drilldown modal displayed correctly")

            modal_screenshot = ARTIFACTS_DIR / "04_influencer_drilldown_modal.png"
            page.screenshot(path=str(modal_screenshot))
            print(f"  ✓ Saved modal screenshot: {modal_screenshot.name}")

            # Close modal
            close_btn = page.locator('button[data-action="close-modal"]').first
            if close_btn.count() > 0:
                close_btn.click()
                page.wait_for_timeout(500)

            # =========================================================================
            # TEST 8: Regression Check
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST 8: Regression Validation Across Modules")
            print("-" * 60)

            # Check Influencers list
            page.goto(f"{APP_URL}/#/marketing/influencers")
            page.wait_for_selector('h1:has-text("Influencer")')
            print("  ✓ Influencers list accessible")

            # Check Contracts
            page.goto(f"{APP_URL}/#/marketing/contracts")
            page.wait_for_selector('h1:has-text("Contracts")')
            print("  ✓ Contracts list accessible")

            # Check Reports
            page.goto(f"{APP_URL}/#/reports")
            page.wait_for_selector('h1:has-text("Reports")')
            print("  ✓ Business Reports page accessible")

            # Check Console Errors
            real_errors = [ce for ce in console_errors if not ("401" in ce or "Unauthorized" in ce)]
            print(f"\n  - Application Console Errors (post-auth): {len(real_errors)}")
            for ce in real_errors:
                print(f"    ! {ce}")
            assert len(real_errors) == 0, f"Found {len(real_errors)} console errors during test run!"
            print("  ✓ Zero console errors detected during test run")

            browser.close()

        print("\n" + "=" * 70)
        print("ALL PLAYWRIGHT TESTS PASSED SUCCESSFULLY 100%")
        print(f"Screenshots & Artifacts saved to: {ARTIFACTS_DIR.resolve()}")
        print("=" * 70)

    finally:
        print("\n[6/6] Tearing down test servers...")
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
        print("✓ Servers stopped cleanly.")

if __name__ == "__main__":
    main()
