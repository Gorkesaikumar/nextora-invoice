import base64
from pathlib import Path
from playwright.sync_api import sync_playwright

pdf_path = Path("test_inf_0003.pdf")
pdf_bytes = pdf_path.read_bytes()
pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    render_html = Path("tests/render_pdf.html").resolve()
    page.goto(f"file:///{render_html}")
    page.wait_for_selector("#status")
    res = page.evaluate("window.renderPdfBase64", pdf_b64)
    print("Render result:", res)
    num_pages = res.get("numPages", 0)
    out_dir = Path(r"C:\Users\praveen\.gemini\antigravity\brain\3f36e9bc-41a1-435f-8620-2f9b061e2862")
    for i in range(1, num_pages + 1):
        canvas = page.locator(f"#canvas-page-{i}")
        out_path = out_dir / f"NC_INF_0003_page_{i}.png"
        canvas.screenshot(path=str(out_path))
        print(f"Saved {out_path.name}")
    browser.close()
