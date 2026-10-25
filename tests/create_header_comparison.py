from PIL import Image
from pathlib import Path

art_dir = Path(r"C:\Users\praveen\.gemini\antigravity\brain\3f36e9bc-41a1-435f-8620-2f9b061e2862")

old_p1 = Image.open(art_dir / "ref_pdf_page_1.png")
new_p1 = Image.open(art_dir / "NC_INF_0003_page_1.png")

# Crop header (top 500px)
old_head = old_p1.crop((0, 0, old_p1.width, 500))
new_head = new_p1.crop((0, 0, new_p1.width, 500))

# Create side-by-side comparison
comp_w = old_head.width + new_head.width + 20
comp_h = max(old_head.height, new_head.height) + 40
comp = Image.new("RGB", (comp_w, comp_h), (240, 242, 245))

comp.paste(old_head, (0, 30))
comp.paste(new_head, (old_head.width + 20, 30))

out_path = art_dir / "07_influencer_header_before_after.png"
comp.save(str(out_path))
print("Saved 07_influencer_header_before_after.png")
