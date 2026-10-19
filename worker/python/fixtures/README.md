# PDF extraction fixtures

## `malformed-table-crop-page-edge.pdf`

Minimal authorised **synthetic** clinical-table PDF for outstanding issue `#076`.

- No patient identifiers, no third-party copyrighted content.
- A4 page (`595.28 × 841.89`), one titled 4-row table whose final row straddles the page bottom (`y0=824` … `y1=860`; page ends at `841.89`).
- Regenerated with PyMuPDF via the geometry constants pinned in `test_extract_pdf_assets_page_edge_crop.py`.

### Failing stage (pre-fix)

`page.find_tables()` (`extraction_method=pymupdf_find_tables`) returns a candidate bbox that ends at the last **fully** detected row (`y1=824`). Without extension, `expanded_rect(..., 4, 4)` yielded crop clip `[46, 712, 564, 828]`, so:

- ~14 px of still-on-page content for the straddling score-`5` row was omitted from the `table_crop` pixmap
- structured `table_rows` silently dropped that row
- no incompleteness warning was emitted

### Fix stage

`extend_table_rect_for_edge_content` grows the candidate using nearby source drawings toward the page edge, then `save_page_crop` renders the clamped remnant. Crop expansion preserves artwork; it does not establish clinical cell ownership. The current ruled-edge extractor requires actual visible ruling on all four sides of each recovered cell. Text without that geometry remains in the page text and in `unassigned_edge_text`, with `edge_recovery_needs_review` and a `table_edge_association_unverified` warning. Page-clipped continuation separately sets `rows_truncated`, `crop_completeness=0.9`, and a `table_crop_edge_incomplete` warning.

### Expected geometry after the fix

- `table_crop.bbox[3]` (clip bottom) ≥ `page_height - 1`
- structured rows include the on-page remnant of score `5`, or incompleteness is marked

The additional synthetic outline/key case in `test_extract_pdf_assets_page_edge_crop.py` is generated in memory. Its aligned explanatory key must remain outside `table_rows` and accessible table markup while its complete text and expanded source artwork are retained. These expectations follow the current ruled-edge/raster extractor (`2026-10-19.ruled-edge-raster-table-ocr-v9`), without restoring the former proximity-based row heuristic or its metadata.
