"""Inspect every rendered PDF page for repeated identity and missing/overlapping rows."""
from pathlib import Path
import json
import re
import fitz

results = []
for path in sorted(Path("repeated-header-proof").glob("*.pdf")):
    doc = fitz.open(path)
    assert len(doc) > 1, f"{path}: fixture did not paginate"
    all_rows = []
    for number, page in enumerate(doc, 1):
        text = page.get_text()
        assert "PRINT_HEADER_PROOF_2026" in text, f"{path}:{number}: missing version header"
        assert "COLUMN_KEY" in text, f"{path}:{number}: missing column/group header"
        assert page.get_images(), f"{path}:{number}: missing university logo"
        header_rects = page.search_for("PRINT_HEADER_PROOF_2026")
        row_rects = [r for match in re.findall(r"ROW\d{3}", text) for r in page.search_for(match)]
        assert row_rects, f"{path}:{number}: orphan header/footer page"
        assert min(r.y0 for r in row_rects) > max(r.y1 for r in header_rects), f"{path}:{number}: header overlap"
        assert all(0 <= r.x0 < r.x1 <= page.rect.width and 0 <= r.y0 < r.y1 <= page.rect.height for r in row_rects), f"{path}:{number}: clipped content"
        all_rows.extend(re.findall(r"ROW\d{3}", text))
        if number in (1, 2, len(doc)):
            page.get_pixmap(matrix=fitz.Matrix(1, 1)).save(path.with_name(f"{path.stem}-page-{number}.png"))
    if path.name.startswith("instructor"):
        assert sorted(set(all_rows)) == [f"ROW{i:03}" for i in range(18)], f"{path}: missing individual schedule rows"
    else:
        assert sorted(all_rows) == [f"ROW{i:03}" for i in range(140)], f"{path}: missing or duplicate rows"
    results.append({"file": path.name, "pages": len(doc), "rows": len(all_rows), "every_page_has_identity": True})
Path("repeated-header-proof/results.json").write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
