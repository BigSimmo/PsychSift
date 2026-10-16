// JavaScript PDF fallback used when the Python PDF helper is unavailable (developer machines
// without PyMuPDF). It reads the PDF with the same pdfjs-dist copy the app already ships for the
// viewer and the roster import, so only one PDF engine is installed. Text joining and image
// decoding follow the pdf-parse 2.4 defaults this replaced, so fallback output is unchanged.

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfLoadingTask = ReturnType<PdfjsModule["getDocument"]>;
type PdfDocument = Awaited<PdfLoadingTask["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

type CanvasAndContext = {
  canvas: { toBuffer?: (mime: string) => Buffer };
  context: {
    createImageData(width: number, height: number): { data: Uint8ClampedArray };
    putImageData(data: unknown, x: number, y: number): void;
    drawImage(image: unknown, x: number, y: number): void;
    getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
  };
};
type CanvasFactory = { create(width: number, height: number): CanvasAndContext };

type EmbeddedImage = { width: number; height: number; kind: number | null | undefined; data: Uint8Array };

export type PdfjsFallbackOptions = {
  data: Uint8Array | Buffer;
  /** Largest decoded image, in pixels, pdf.js may allocate. */
  maxImageSize?: number;
  /** Raise recoverable parse errors instead of skipping them. pdf.js only enforces maxImageSize when set. */
  stopAtErrors?: boolean;
};

export type PdfjsTextResult = { pages: { num: number; text: string }[]; text: string; total: number };

export type PdfjsImageResult = {
  pages: { pageNumber: number; images: { data: Uint8Array; name: string; width: number; height: number }[] }[];
  total: number;
};

const LINE_THRESHOLD = 4.6;
const CELL_THRESHOLD = 7;
const CELL_SEPARATOR = "\t";

let pdfjsModule: Promise<PdfjsModule> | undefined;

function loadPdfjs() {
  pdfjsModule ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsModule;
}

export class PdfjsFallbackParser {
  private readonly options: PdfjsFallbackOptions;
  private task: PdfLoadingTask | undefined;
  private doc: PdfDocument | undefined;

  constructor(options: PdfjsFallbackOptions) {
    this.options = options;
  }

  private async load(): Promise<{ pdfjs: PdfjsModule; doc: PdfDocument }> {
    const pdfjs = await loadPdfjs();
    if (!this.doc) {
      const data = this.options.data;
      this.task = pdfjs.getDocument({
        data: Buffer.isBuffer(data) ? new Uint8Array(data) : data,
        maxImageSize: this.options.maxImageSize,
        stopAtErrors: this.options.stopAtErrors,
        verbosity: pdfjs.VerbosityLevel.ERRORS,
      });
      this.doc = await this.task.promise;
    }
    return { pdfjs, doc: this.doc };
  }

  async destroy() {
    const task = this.task;
    this.task = undefined;
    this.doc = undefined;
    if (task) await task.destroy();
  }

  async getText(): Promise<PdfjsTextResult> {
    const { doc } = await this.load();
    const result: PdfjsTextResult = { pages: [], text: "", total: doc.numPages };
    for (let num = 1; num <= doc.numPages; num += 1) {
      const page = await doc.getPage(num);
      result.pages.push({ num, text: await pageText(page) });
      page.cleanup();
    }
    for (const page of result.pages) {
      result.text += `${page.text}\n-- ${page.num} of ${result.total} --\n\n`;
    }
    return result;
  }

  /** Embedded images on the requested pages, as PNG bytes, skipping images at or under `imageThreshold` px. */
  async getImage(params: { partial: number[]; imageThreshold: number }): Promise<PdfjsImageResult> {
    const { pdfjs, doc } = await this.load();
    const canvasFactory = (doc as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const result: PdfjsImageResult = { pages: [], total: doc.numPages };
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      if (!params.partial.includes(pageNumber)) continue;
      const page = await doc.getPage(pageNumber);
      try {
        const ops = await page.getOperatorList();
        const pageImages: PdfjsImageResult["pages"][number] = { pageNumber, images: [] };
        result.pages.push(pageImages);
        for (let index = 0; index < ops.fnArray.length; index += 1) {
          const fn = ops.fnArray[index];
          if (fn !== pdfjs.OPS.paintInlineImageXObject && fn !== pdfjs.OPS.paintImageXObject) continue;
          // An inline image carries its pixels in the operator itself; only XObjects are looked up by id.
          // Looking an inline image up by id waits on an object that never resolves, so the page would hang.
          const inline = fn === pdfjs.OPS.paintInlineImageXObject;
          const name = inline ? `inline-${index}` : (ops.argsArray[index][0] as string);
          const { width, height, kind, data } = inline
            ? toEmbeddedImage(ops.argsArray[index][0], name, canvasFactory)
            : await resolveEmbeddedImage(page.commonObjs.has(name) ? page.commonObjs : page.objs, name, canvasFactory);
          if (params.imageThreshold >= width || params.imageThreshold >= height) continue;
          const { canvas, context } = canvasFactory.create(width, height);
          const imageData = context.createImageData(width, height);
          if (kind === pdfjs.ImageKind.RGBA_32BPP) {
            imageData.data.set(data);
          } else {
            convertToRgba(pdfjs, { src: data, dest: new Uint32Array(imageData.data.buffer), width, height, kind });
          }
          context.putImageData(imageData, 0, 0);
          const png = canvas.toBuffer?.("image/png");
          pageImages.images.push({ data: png ? new Uint8Array(png) : new Uint8Array(), name, width, height });
        }
      } finally {
        // Release the page's decoded images before the next page, so memory stays one page deep.
        page.cleanup();
      }
    }
    return result;
  }
}

async function pageText(page: PdfPage) {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
  const parts: string[] = [];
  let lastX: number | undefined;
  let lastY: number | undefined;
  let lineHeight = 0;
  for (const item of textContent.items) {
    if (!("str" in item)) continue;
    let str = item.str;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    if (lastY !== undefined && Math.abs(lastY - y) > LINE_THRESHOLD) {
      const lastPart = parts.at(-1);
      const startsNewLine = str.startsWith("\n") || (str.trim() === "" && item.hasEOL);
      if (lastPart?.endsWith("\n") === false && !startsNewLine && Math.abs(lastY - y) - 1 > lineHeight) {
        parts.push("\n");
        lineHeight = 0;
      }
    }
    if (lastY !== undefined && Math.abs(lastY - y) < LINE_THRESHOLD) {
      if (lastX !== undefined && Math.abs(lastX - x) > CELL_THRESHOLD) str = `${CELL_SEPARATOR}${str}`;
    }
    parts.push(str);
    lastX = x + item.width;
    lastY = y;
    lineHeight = Math.max(lineHeight, item.height);
    if (item.hasEOL) parts.push("\n");
    if (item.hasEOL || str.endsWith("\n")) lineHeight = 0;
  }
  return parts.join("");
}

type PdfObjects = { get(name: string, callback: (data: unknown) => void): unknown };

function resolveEmbeddedImage(objects: PdfObjects, name: string, canvasFactory: CanvasFactory): Promise<EmbeddedImage> {
  return new Promise((resolve, reject) => {
    objects.get(name, (raw) => {
      try {
        resolve(toEmbeddedImage(raw, name, canvasFactory));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function toEmbeddedImage(raw: unknown, name: string, canvasFactory: CanvasFactory): EmbeddedImage {
  const image = raw as {
    width: number;
    height: number;
    kind?: number | null;
    data?: ArrayBufferView;
    bitmap?: { width: number; height: number };
  } | null;
  if (!image) throw new Error(`Image object ${name} not found`);
  let data: Uint8Array | undefined;
  if (image.data instanceof Uint8Array) {
    data = image.data;
  } else if (image.data instanceof Uint8ClampedArray) {
    data = new Uint8Array(image.data);
  } else if (image.bitmap) {
    const { context } = canvasFactory.create(image.bitmap.width, image.bitmap.height);
    context.drawImage(image.bitmap, 0, 0);
    data = new Uint8Array(context.getImageData(0, 0, image.bitmap.width, image.bitmap.height).data.buffer);
  } else if (image.data && ArrayBuffer.isView(image.data)) {
    data = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  }
  if (!data) {
    throw new Error(
      `Image object ${name}: data field is empty or invalid. Available fields: ${Object.keys(image).join(", ")}`,
    );
  }
  if (data.length === 0) throw new Error(`Image object ${name}: data buffer is empty (length: 0)`);
  return { width: image.width, height: image.height, kind: image.kind, data };
}

function convertToRgba(
  pdfjs: PdfjsModule,
  {
    src,
    dest,
    width,
    height,
    kind,
  }: { src: Uint8Array; dest: Uint32Array; width: number; height: number; kind: number | null | undefined },
) {
  const pixels = width * height;
  const fromRgb = () => {
    for (let i = 0, j = 0; i < src.length; i += 3, j += 1) {
      dest[j] = (255 << 24) | (src[i + 2]! << 16) | (src[i + 1]! << 8) | src[i]!;
    }
  };
  if (kind === pdfjs.ImageKind.RGB_24BPP) {
    fromRgb();
  } else if (kind === pdfjs.ImageKind.GRAYSCALE_1BPP) {
    let pixel = 0;
    for (const byte of src) {
      for (let bit = 7; bit >= 0; bit -= 1) {
        if (pixel >= pixels) break;
        const gray = ((byte >> bit) & 1) === 1 ? 255 : 0;
        dest[pixel++] = (255 << 24) | (gray << 16) | (gray << 8) | gray;
      }
    }
  } else if (kind === undefined || kind === null) {
    const bytesPerPixel = src.length / pixels;
    if (Math.abs(bytesPerPixel - 3) < 0.1) {
      fromRgb();
    } else if (Math.abs(bytesPerPixel - 4) < 0.1) {
      for (let i = 0, j = 0; i < src.length; i += 4, j += 1) {
        dest[j] = (src[i + 3]! << 24) | (src[i + 2]! << 16) | (src[i + 1]! << 8) | src[i]!;
      }
    } else if (Math.abs(bytesPerPixel - 1) < 0.1) {
      for (let i = 0; i < src.length; i += 1) {
        const gray = src[i]!;
        dest[i] = (255 << 24) | (gray << 16) | (gray << 8) | gray;
      }
    } else {
      throw new Error(
        `convertToRGBA: Cannot infer image format. kind: ${kind}, bytesPerPixel: ${bytesPerPixel}, width: ${width}, height: ${height}, dataLength: ${src.length}`,
      );
    }
  } else {
    throw new Error(`convertToRGBA: Unsupported image kind: ${kind}.`);
  }
}
