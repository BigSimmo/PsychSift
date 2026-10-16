import { describe, expect, it } from "vitest";
import { PdfjsFallbackParser } from "@/lib/extractors/pdfjs-fallback";

// A one-page PDF whose content stream paints a 30 x 30 RGB image inline (BI ... ID ... EI),
// rather than through a named image XObject.
function inlineImagePdf() {
  const side = 30;
  const pixels = Buffer.alloc(side * side * 3, 0);
  for (let pixel = 0; pixel < side * side; pixel += 1) pixels[pixel * 3] = 255;
  const content = `q ${side} 0 0 ${side} 10 10 cm BI /W ${side} /H ${side} /CS /RGB /BPC 8 /F /AHx ID ${pixels.toString("hex")}> EI Q`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

describe("PdfjsFallbackParser", () => {
  it("extracts an inline image instead of waiting forever for it", async () => {
    const parser = new PdfjsFallbackParser({ data: inlineImagePdf(), stopAtErrors: true });
    try {
      const result = await Promise.race([
        parser.getImage({ partial: [1], imageThreshold: 20 }),
        new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), 5000)),
      ]);
      expect(result).not.toBe("timed out");
      if (result === "timed out") return;
      const [image] = result.pages[0]?.images ?? [];
      expect(image).toMatchObject({ width: 30, height: 30 });
      expect(image?.data.byteLength).toBeGreaterThan(0);
    } finally {
      await parser.destroy();
    }
  });
});
