import os
import sys
import time
import socket
import subprocess
import base64
import sqlite3
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
import pypdf

# Ensure utf-8 output on Windows
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

ARTIFACTS_DIR = Path(r"C:\Users\praveen\.gemini\antigravity\brain\3f36e9bc-41a1-435f-8620-2f9b061e2862")
API_PORT = 8888
VITE_PORT = 5174
APP_URL = f"http://localhost:{VITE_PORT}"

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
    print("MASTER TEST SUITE: Influencer Agreement PDF & Preview Parity")
    print("Tests A through F Verification")
    print("=" * 70)

    # 1. Ensure SQLite database has reference contract NC/INF/2026-27/0003
    print("\n[1/7] Ensuring reference contract NC/INF/2026-27/0003 is seeded...")
    subprocess.run([sys.executable, "tests/seed_ref_influencer.py"], check=True)

    # Clean env for server processes
    server_env = os.environ.copy()
    server_env.pop("DATABASE_URL", None)
    server_env["API_PORT"] = str(API_PORT)
    server_env["PORT"] = str(API_PORT)
    server_env["APP_URL"] = f"http://localhost:{VITE_PORT}"
    server_env["ORIGIN"] = f"http://localhost:{VITE_PORT}"

    # 2. Check / Start API Server
    api_proc = None
    if not is_port_in_use(API_PORT):
        print(f"\n[2/7] Starting API Server on port {API_PORT} (SQLite default)...")
        api_proc = subprocess.Popen(
            "node server/local.js",
            shell=True,
            env=server_env
        )
        if not wait_for_url(f"http://127.0.0.1:{API_PORT}/api/auth/me", timeout=25):
            print("API Server failed to start!")
            sys.exit(1)
        print("  ✓ API Server is ready.")
    else:
        print(f"  ✓ API Server already running on port {API_PORT}.")

    # 3. Check / Start Vite Dev Server
    vite_proc = None
    if not is_port_in_use(VITE_PORT):
        print(f"\n[3/7] Starting Vite Dev Server on port {VITE_PORT}...")
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

    console_errors = []
    network_failures = []

    try:
        print("\n[4/7] Launching Playwright Chromium Browser...")
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
                page.wait_for_timeout(2000)
                print(f"  - Current URL after submit: {page.url}")
                err_el = page.locator("#login-error")
                if err_el.count() > 0 and err_el.is_visible():
                    print(f"  ! Login error element text: '{err_el.inner_text()}'")

            page.wait_for_selector('a[href="#/reports"]', timeout=15000)
            print("  ✓ Authenticated session active.")

            # =========================================================================
            # TEST A: Influencer Agreement Preview (NC/INF/2026-27/0003)
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST A: Influencer Agreement Preview Verification")
            print("Reference Contract: NC/INF/2026-27/0003 (Ramya Madhuri / Nizamabad_pilla)")
            print("-" * 60)

            print("  - Navigating to Marketing & Partnerships -> Contracts & Agreements...")
            page.goto(f"{APP_URL}/#/marketing/contracts")
            page.wait_for_selector('table', timeout=10000)
            page.wait_for_timeout(800)

            contract_link = page.locator('text=NC/INF/2026-27/0003').first
            assert contract_link.count() >= 1, "Contract NC/INF/2026-27/0003 not found in contracts list!"
            print("  ✓ Found contract NC/INF/2026-27/0003 in contracts table.")

            inf_ref_id = "c03a950a-4286-4f41-a189-60195e330003"
            inf_preview_url = f"{APP_URL}/#/marketing/contracts/{inf_ref_id}/preview"
            print(f"  - Opening preview: {inf_preview_url}")
            page.goto(inf_preview_url)
            page.wait_for_selector(".nc-influencer-doc", timeout=12000)
            page.wait_for_timeout(1000)

            # Check Company Logo & Product Logo in Preview
            comp_logo = page.locator(".nc-company-logo")
            assert comp_logo.count() == 1, "Company logo not found in preview"
            assert comp_logo.is_visible(), "Company logo is not visible in preview"
            comp_src = comp_logo.get_attribute("src") or ""
            assert comp_src.startswith("data:image/"), "Company logo is not loaded as valid data URI"
            print(f"  ✓ Company logo verified (data URI length: {len(comp_src)})")

            prod_logo = page.locator(".nc-product-logo")
            assert prod_logo.count() == 1, "Product logo not found in preview"
            assert prod_logo.is_visible(), "Product logo is not visible in preview"
            prod_src = prod_logo.get_attribute("src") or ""
            assert prod_src.startswith("data:image/"), "Product logo is not loaded as valid data URI"
            print(f"  ✓ Product logo verified (data URI length: {len(prod_src)})")

            # Check Header & Metadata
            doc_text = page.locator(".nc-influencer-doc").inner_text()
            assert "CONTRACT #NC/INF/2026-27/0003" in doc_text, "Missing contract pill in preview"
            assert "INFLUENCER MARKETING & REVENUE-SHARING AGREEMENT — NEXTORA POS" in doc_text, "Missing document title"
            assert "Marketing Partnership & Commercial Revenue-Sharing Terms" in doc_text, "Missing subtitle"
            assert "BRAND & PRODUCT OWNER" in doc_text.upper()
            assert "INFLUENCER / MARKETING PARTNER" in doc_text.upper()
            assert "Nextora Creations" in doc_text
            assert "Ramya Madhuri" in doc_text
            assert "@nizamabad_pilla__19" in doc_text
            assert "Instagram Reels" in doc_text
            assert "50.00%" in doc_text
            assert "Nextora POS Mobile App" in doc_text
            assert "Nextora POS Desktop" in doc_text
            print("  ✓ All metadata, party details, and commercial terms verified in preview")

            # Capture Preview Screenshots
            preview_container = page.locator(".nc-influencer-doc")
            preview_full_path = ARTIFACTS_DIR / "05_influencer_preview_full.png"
            preview_container.screenshot(path=str(preview_full_path))
            print(f"  ✓ Saved full preview screenshot: {preview_full_path.name}")

            preview_header = page.locator(".nc-contract-header")
            preview_header_path = ARTIFACTS_DIR / "05a_influencer_preview_header.png"
            preview_header.screenshot(path=str(preview_header_path))
            print(f"  ✓ Saved header preview screenshot: {preview_header_path.name}")

            print(">>> TEST A PASSED: Influencer Agreement Preview Validated <<<")

            # =========================================================================
            # TEST B: Download PDF & Multi-Page Visual Verification
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST B: Download PDF and Multi-Page Visual Inspection")
            print("-" * 60)

            dl_btn = page.locator('button[data-action="download-pdf-btn"]')
            assert dl_btn.count() == 1, "Download PDF button not found"

            print("  - Clicking 'Download PDF' button...")
            with page.expect_download(timeout=15000) as download_info:
                dl_btn.click()
            download = download_info.value
            pdf_path = ARTIFACTS_DIR / "NC_INF_2026-27_0003_Influencer_Agreement.pdf"
            download.save_as(str(pdf_path))

            with open(pdf_path, "rb") as f:
                pdf_data = f.read()
            assert pdf_data.startswith(b"%PDF-"), "Downloaded file is not a valid PDF"
            assert len(pdf_data) > 30000, f"Downloaded PDF is unexpectedly small: {len(pdf_data)} bytes"
            print(f"  ✓ Downloaded PDF is valid ({len(pdf_data)} bytes)")

            # Parse via PyPDF
            reader = pypdf.PdfReader(str(pdf_path))
            total_pages = len(reader.pages)
            print(f"  ✓ Total PDF Pages: {total_pages}")
            assert total_pages == 3, f"Expected exactly 3 pages, got {total_pages}"

            # Render every page via Chromium canvas (tests/render_pdf.html)
            print("  - Rendering all 3 PDF pages to PNG images via Chromium canvas...")
            pdf_b64 = base64.b64encode(pdf_data).decode("utf-8")
            render_html_path = Path("tests/render_pdf.html").resolve()
            render_page = context.new_page()
            render_page.goto(f"file:///{render_html_path}")
            render_page.wait_for_selector("#status")

            render_res = render_page.evaluate(f"window.renderPdfBase64('{pdf_b64}')")
            assert render_res.get("success"), f"PDF rendering failed: {render_res.get('error')}"
            render_page.wait_for_timeout(1000)

            for i in range(1, total_pages + 1):
                page_wrapper = render_page.locator(f"#wrapper-{i}")
                page_out = ARTIFACTS_DIR / f"06_influencer_pdf_page_{i}.png"
                page_wrapper.screenshot(path=str(page_out))
                print(f"  ✓ Rendered & saved PDF Page {i}: {page_out.name}")
            render_page.close()

            print(">>> TEST B PASSED: Download PDF & All Pages Verified <<<")

            # =========================================================================
            # TEST C: Generate PDF Action Verification
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST C: Generate PDF Action Verification")
            print("-" * 60)

            gen_btn = page.locator('button[data-action="generate-pdf-btn"]')
            assert gen_btn.count() == 1, "Generate PDF button not found"

            print("  - Clicking 'Generate PDF' button...")
            with page.expect_response(lambda r: "/generate-pdf" in r.url and r.status == 200, timeout=15000) as resp_info:
                gen_btn.click()
            gen_resp = resp_info.value
            gen_json = gen_resp.json()
            assert gen_json.get("success") is True, f"Generate PDF response not successful: {gen_json}"
            assert gen_json.get("contract_number") == "NC/INF/2026-27/0003"
            print("  ✓ Generate PDF endpoint responded successfully, snapshot preserved")
            print(">>> TEST C PASSED: Generate PDF Workflow Validated <<<")

            # =========================================================================
            # TEST D: Section-Aware Pagination & Structural Checks
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST D: Section-Aware Pagination Validation")
            print("-" * 60)

            p1_text = reader.pages[0].extract_text()
            p2_text = reader.pages[1].extract_text()
            p3_text = reader.pages[2].extract_text()

            # Page 1 checks
            assert "SECTION 1: PARTIES TO THE AGREEMENT" in p1_text
            assert "SECTION 2: PURPOSE OF THE PARTNERSHIP" in p1_text
            assert "SECTION 3: SCOPE OF WORK & MARKETING DELIVERABLES" in p1_text
            assert "Instagram Reels" in p1_text
            assert "Page 1 of 3" in p1_text
            print("  ✓ Page 1 contains Sections 1, 2, and 3 cleanly with Deliverables Table")

            # Page 2 checks
            assert "SECTION 4: REVENUE-SHARING TERMS & CALCULATION BASIS" in p2_text
            assert "1. Qualifying Eligible Sales:" in p2_text
            assert "2. Attribution Window & Deductions:" in p2_text
            assert "3. Tax Integrity:" in p2_text
            assert "4. Threshold & Monthly Commission Settlement:" in p2_text
            assert "5. Pending Commissions at Expiry:" in p2_text
            assert "ILLUSTRATIVE CALCULATION EXAMPLE (NON-BINDING)" in p2_text
            assert "Nextora POS Mobile App" in p2_text
            assert "Nextora POS Desktop" in p2_text
            assert "Telangana Intra-State Supplies (CGST 9% + SGST 9%)" in p2_text
            assert "Interstate Supplies (IGST 18%)" in p2_text
            assert "SECTION 5: MARKETING OBLIGATIONS AND PROFESSIONAL CONDUCT" in p2_text
            assert "SECTION 6: BRAND ASSETS AND INTELLECTUAL PROPERTY" in p2_text
            assert "Page 2 of 3" in p2_text
            print("  ✓ Page 2 groups Section 4 (all 5 points + calculation table + GST cards), Section 5, and Section 6")

            # Page 3 checks
            assert "SECTION 7: PAYMENT SCHEDULE, INVOICING & TAXES" in p3_text
            assert "1. Reconciliation & Reporting:" in p3_text
            assert "2. Invoicing & Documentation:" in p3_text
            assert "3. Statutory Deductions:" in p3_text
            assert "4. Monthly Payment Settlement:" in p3_text
            assert "SECTION 8: TERM, TERMINATION & POST-TERMINATION RIGHTS" in p3_text
            assert "SECTION 9: GENERAL LEGAL PROVISIONS" in p3_text
            assert "SECTION 10: ACCEPTANCE & EXECUTION" in p3_text
            assert "FOR NEXTORA CREATIONS:" in p3_text
            assert "FOR INFLUENCER / MARKETING PARTNER:" in p3_text
            assert "Gorke Sai Kumar" in p3_text
            assert "Founder & CEO" in p3_text
            assert "Ramya Madhuri" in p3_text
            assert "Page 3 of 3" in p3_text
            print("  ✓ Page 3 groups Section 7, Section 8, Section 9, and Section 10 Signatures cleanly")
            print(">>> TEST D PASSED: Section-Aware Pagination & Structural Flow Validated <<<")

            # =========================================================================
            # TEST E: Software Contract Regression (NC/SDA/2026-27/0001)
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST E: Software Contract Regression Verification")
            print("Reference Contract: NC/SDA/2026-27/0001 (Sevajobs / Raghava)")
            print("-" * 60)

            sw_ref_id = "d1145e0a-c838-4b36-9b49-34f49bf2063f"
            sw_preview_url = f"{APP_URL}/#/marketing/contracts/software/{sw_ref_id}/preview"
            print(f"  - Navigating to software preview: {sw_preview_url}")
            page.goto(sw_preview_url)
            page.wait_for_selector(".nc-contract-doc", timeout=10000)
            page.wait_for_timeout(800)

            sw_logo_img = page.locator(".nc-logo-wrap img")
            assert sw_logo_img.count() == 1, "Company logo not found in software preview"
            assert sw_logo_img.is_visible()

            # Download Software Contract PDF
            sw_dl_btn = page.locator('button[data-action="download-sw-pdf-btn"]')
            assert sw_dl_btn.count() == 1
            with page.expect_download(timeout=15000) as sw_dl_info:
                sw_dl_btn.click()
            sw_dl = sw_dl_info.value
            sw_pdf_path = ARTIFACTS_DIR / "NC_SDA_2026-27_0001_Software_Development_Agreement.pdf"
            sw_dl.save_as(str(sw_pdf_path))

            with open(sw_pdf_path, "rb") as f:
                sw_pdf_bytes = f.read()
            assert sw_pdf_bytes.startswith(b"%PDF-")
            assert len(sw_pdf_bytes) > 30000

            sw_reader = pypdf.PdfReader(str(sw_pdf_path))
            sw_all_text = "\n".join([p.extract_text() for p in sw_reader.pages])
            assert "SOFTWARE DEVELOPMENT SERVICES AGREEMENT" in sw_all_text
            assert "SECTION 1: PARTIES TO THE AGREEMENT" in sw_all_text
            assert "SECTION 10: ACCEPTANCE & EXECUTION" in sw_all_text
            assert "20,000.00" in sw_all_text
            assert "16,949.15" in sw_all_text
            assert "3,050.85" in sw_all_text
            print("  ✓ Software contract preview and PDF download verified: 0 regression!")
            print(">>> TEST E PASSED: Software Contract Regression Succeeded <<<")

            # =========================================================================
            # TEST F: Contract Data Integrity
            # =========================================================================
            print("\n" + "-" * 60)
            print("RUNNING TEST F: Contract Data Integrity Verification")
            print("-" * 60)

            con = sqlite3.connect("data/nextora.sqlite")
            cur = con.cursor()
            cur.execute("""
                SELECT contract_number, version, status, influencer_id, start_date, end_date,
                       commission_basis_points, commission_basis, product_tax_mode, commission_tax_terms,
                       signatory_name, signatory_title, influencer_signatory_name
                FROM inv_influencer_agreements
                WHERE contract_number = ?
            """, ("NC/INF/2026-27/0003",))
            row = cur.fetchone()
            assert row is not None, "Contract NC/INF/2026-27/0003 record missing from database!"

            assert row[0] == "NC/INF/2026-27/0003"
            assert row[1] == 1
            assert row[2] in ("DRAFT", "ACTIVE")
            assert row[4] == "2026-10-25"
            assert row[5] == "2027-10-25"
            assert row[6] == 5000
            assert row[7] == "NET_SALES_EX_GST"
            assert row[8] == "INCLUSIVE"
            assert row[9] == "EXCLUSIVE"
            assert row[10] == "Gorke Sai Kumar"
            assert row[11] == "Founder & CEO"
            assert row[12] == "Ramya Madhuri"

            cur.execute("""
                SELECT legal_name, display_name, instagram_username
                FROM inv_influencers
                WHERE id = ?
            """, (row[3],))
            inf_row = cur.fetchone()
            assert inf_row is not None
            assert inf_row[0] == "Ramya Madhuri"
            assert inf_row[1] == "Nizamabad_pilla"
            assert inf_row[2] == "@nizamabad_pilla__19"

            con.close()
            print("  ✓ Stored database fields 100% intact and unmutated.")
            print(">>> TEST F PASSED: Contract Data Integrity Confirmed <<<")

            # Browser console and network check
            real_errors = [ce for ce in console_errors if not ("401" in ce or "Unauthorized" in ce)]
            print(f"\n  - Application Console Errors (post-auth): {len(real_errors)}")
            for ce in real_errors:
                print(f"    ! {ce}")
            assert len(real_errors) == 0, f"Found {len(real_errors)} console errors during test run!"
            print("  ✓ Zero browser console errors detected during application usage")

            critical_failures = [f for f in network_failures if not ("favicon" in f or "chrome-extension" in f or "ERR_ABORTED" in f)]
            print(f"  - Critical Network Request Failures: {len(critical_failures)}")
            assert len(critical_failures) == 0, f"Found critical network failures: {critical_failures}"
            print("  ✓ Zero network request failures for fonts, logos, or styles")

            browser.close()

    finally:
        print("\n[6/7] Tearing down servers...")
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

    print("\n" + "=" * 70)
    print("ALL PLAYWRIGHT TESTS PASSED (TESTS A, B, C, D, E, F) 100% SUCCESS")
    print(f"Artifacts saved in: {ARTIFACTS_DIR.resolve()}")
    print("=" * 70)

if __name__ == "__main__":
    main()
