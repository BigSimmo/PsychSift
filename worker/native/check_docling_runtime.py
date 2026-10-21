"""Offline final-image control through the real Docling/Tesseract shadow path."""
from pathlib import Path
import sys
import tempfile

import fitz

sys.path.insert(0, "/app/worker/python")
from shadow_docling_extract import build_converter


with tempfile.TemporaryDirectory(prefix="psychsift-native-shadow-") as directory:
    # Rasterize synthetic text so a PDF text layer cannot bypass OCR.
    source = fitz.open()
    page = source.new_page()
    page.insert_text((72, 100), "PsychSift 12345", fontsize=32)
    pixels = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    raster = fitz.open()
    raster.new_page(width=page.rect.width, height=page.rect.height).insert_image(
        page.rect, stream=pixels.tobytes("png")
    )
    fixture = Path(directory) / "synthetic.pdf"
    raster.save(fixture)
    raster.close()
    source.close()
    result = build_converter().convert(str(fixture), raises_on_error=True)
    text = result.document.export_to_markdown()
    assert len(result.document.pages) == 1, "Unexpected synthetic page count"
    assert "12345" in text, "Docling/Tesseract failed to read synthetic image text"
    print("Offline non-root Docling/Tesseract raster-PDF control passed")
