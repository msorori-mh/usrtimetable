"""Inspect every rendered PDF page for repeated identity and missing/overlapping rows."""
from pathlib import Path
import json
import re
import fitz

results = []
for path in sorted(Path("repeated-header-proof").glob("*.pdf")):
    doc = fitz.open(path)
    assert len(doc) >= (1 if path.name.startswith(("university", "room-fit")) else 2), f"{path}: fixture did not paginate"
    if path.name.startswith(("university", "individual")):
        assert len(doc) == 2, f"{path}: compact instructor report must use two pages"
        assert "DETAIL_PROOF" in doc[0].get_text() and "WEEK_PROOF" not in doc[0].get_text(), f"{path}: details must be page one"
        assert "WEEK_PROOF" in doc[1].get_text() and "DETAIL_PROOF" not in doc[1].get_text(), f"{path}: weekly must be page two"
    if path.name.startswith("room-fit"):
        assert len(doc) == 1, f"{path}: 14-row lab schedule must fit one A4 page"
    all_rows = []
    for number, page in enumerate(doc, 1):
        if "portrait" in path.name:
            assert page.rect.height > page.rect.width, f"{path}:{number}: expected portrait"
        if "default" in path.name:
            assert abs(page.rect.width - 595.28) < 2 and abs(page.rect.height - 841.89) < 2, f"{path}:{number}: default must be A4 portrait"
        text = page.get_text()
        assert "PRINT_HEADER_PROOF_2026" in text, f"{path}:{number}: missing version header"
        assert "COLUMN_KEY" in text, f"{path}:{number}: missing column/group header"
        assert page.get_images(), f"{path}:{number}: missing university logo"
        header_rects = page.search_for("PRINT_HEADER_PROOF_2026")
        row_ids = ["ROW" + re.sub(r"\s", "", match) for match in re.findall(r"ROW\s*(\d(?:\s*\d){2})", text)]
        row_rects = [fitz.Rect(word[:4]) for word in page.get_text("words") if word[4].startswith("ROW")]
        if path.name.startswith("university") and not row_rects:
            assert number == len(doc) and "BUSINESS_V1" in text, f"{path}: unexpected blank page"
            continue
        assert row_rects, f"{path}:{number}: orphan header/footer page"
        assert min(r.y0 for r in row_rects) > max(r.y1 for r in header_rects), f"{path}:{number}: header overlap"
        assert all(0 <= r.x0 < r.x1 <= page.rect.width and 0 <= r.y0 < r.y1 <= page.rect.height for r in row_rects), f"{path}:{number}: clipped content"
        if path.name.startswith("readable"):
            spans = [s for b in page.get_text("dict")["blocks"] if "lines" in b
                     for line in b["lines"] for s in line["spans"]]
            row_spans = [s for s in spans if "ROW" in s["text"]]
            assert row_spans and all(s["size"] >= 10.9 for s in row_spans), f"{path}:{number}: body text too small"
            assert "CYB-L3-2024" in text, f"{path}:{number}: missing common cohort"
        all_rows.extend(row_ids)
        if number in (1, 2, len(doc)):
            page.get_pixmap(matrix=fitz.Matrix(1, 1)).save(path.with_name(f"{path.stem}-page-{number}.png"))
    if path.name.startswith("university"):
        assert sorted(set(all_rows)) == [f"ROW{i:03}" for i in range(6)]
        full_text = "\n".join(p.get_text() for p in doc)
        assert "COMPUTING_V1" in full_text and "BUSINESS_V1" in full_text
        assert "12.00" in full_text and "8.00" in full_text and "4.00" in full_text
        doc[-1].get_pixmap(matrix=fitz.Matrix(1,1)).save(path.with_name(f"{path.stem}-page-{len(doc)}.png"))
    elif path.name.startswith("individual"):
        assert sorted(set(all_rows)) == ["ROW000", "ROW001"]
        assert "COMPUTING_V1" in doc[0].get_text(), f"{path}: hours summary must follow details"
    elif path.name.startswith("room-fit"):
        assert sorted(all_rows) == [f"ROW{i:03}" for i in range(14)], f"{path}: missing compact schedule rows"
    elif path.name.startswith("instructor"):
        assert sorted(set(all_rows)) == [f"ROW{i:03}" for i in range(18)], f"{path}: missing individual schedule rows"
    else:
        assert sorted(all_rows) == [f"ROW{i:03}" for i in range(140)], f"{path}: missing or duplicate rows"
    results.append({"file": path.name, "pages": len(doc), "rows": len(all_rows), "every_page_has_identity": True})
Path("repeated-header-proof/results.json").write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))

