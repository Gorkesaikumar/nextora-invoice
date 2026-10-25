import os
import sys
import base64
from playwright.sync_api import sync_playwright

def render_pdf_to_images(pdf_path, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    with open(pdf_path, 'rb') as f:
        pdf_bytes = f.read()
    b64_data = base64.b64encode(pdf_bytes).decode('utf-8')

    html = """
    <!DOCTYPE html>
    <html>
    <head>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    </head>
    <body style="margin:0; background:white;">
      <div id="pages"></div>
      <script>
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        window.renderPdf = async function(base64Data) {
          const raw = atob(base64Data);
          const uint8Array = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) {
            uint8Array[i] = raw.charCodeAt(i);
          }
          const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
          const container = document.getElementById('pages');
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            canvas.id = 'page-' + i;
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.display = 'block';
            canvas.style.marginBottom = '20px';
            container.appendChild(canvas);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          }
          return pdf.numPages;
        };
      </script>
    </body>
    </html>
    """

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(html)
        num_pages = page.evaluate("window.renderPdf", b64_data)
        image_paths = []
        for i in range(1, num_pages + 1):
            canvas = page.locator(f"#page-{i}")
            out_file = os.path.join(output_dir, f"page_{i}.png")
            canvas.screenshot(path=out_file)
            image_paths.append(out_file)
            print(f"Rendered page {i} to {out_file}")
        browser.close()
        return image_paths

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python pdf-to-images.py <pdf_path> <output_dir>")
        sys.exit(1)
    render_pdf_to_images(sys.argv[1], sys.argv[2])
