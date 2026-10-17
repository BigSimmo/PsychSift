import type ExcelJS from "exceljs";
import type JSZip from "jszip";

export type OoxmlArchiveBudgetOptions = {
  maxEntries: number;
  maxExpandedBytes: number;
  maxRatioBytes?: number;
  onUnreadable?: () => Error;
  onTooManyEntries?: () => Error;
  onExpandedBytesExceeded?: () => Error;
};

function toExactArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function readDeclaredEntrySize(entry: JSZip.JSZipObject, onInvalid: () => Error): number {
  const metadata = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
  if (metadata?.uncompressedSize === undefined) return 0;
  const declared = Number(metadata.uncompressedSize);
  if (!Number.isFinite(declared) || declared < 0) {
    throw onInvalid();
  }
  return declared;
}

function streamEntryInflatedBytes(
  entry: JSZip.JSZipObject,
  startingTotal: number,
  maxAllowedBytes: number,
  onExpandedBytesExceeded: () => Error,
  onUnreadable?: () => Error,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const stream = entry.nodeStream("nodebuffer") as NodeJS.ReadableStream & {
      destroy?: (error?: Error) => void;
    };
    let runningTotal = startingTotal;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      stream.destroy?.();
      reject(error);
    };

    stream.on("data", (chunk: Buffer | Uint8Array) => {
      if (settled) return;
      runningTotal += chunk.byteLength;
      if (runningTotal > maxAllowedBytes) {
        fail(onExpandedBytesExceeded());
      }
    });

    stream.on("error", (error: unknown) => {
      if (settled) return;
      if (onUnreadable) {
        fail(onUnreadable());
        return;
      }
      fail(error instanceof Error ? error : new Error(String(error)));
    });

    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(runningTotal);
    });
  });
}

export async function assertOoxmlArchiveLimits(
  bytes: Uint8Array | ArrayBuffer,
  options: OoxmlArchiveBudgetOptions,
): Promise<JSZip> {
  const tooManyEntriesError = () =>
    options.onTooManyEntries ? options.onTooManyEntries() : new Error("OOXML archive contains too many entries.");
  const expandedBytesError = () =>
    options.onExpandedBytesExceeded
      ? options.onExpandedBytesExceeded()
      : new Error("OOXML archive exceeds the safe expanded-size budget.");

  const { default: JSZipModule } = await import("jszip");
  let zip: JSZip;
  try {
    zip = await JSZipModule.loadAsync(bytes);
  } catch (error) {
    if (options.onUnreadable) throw options.onUnreadable();
    throw error;
  }

  const entries = Object.values(zip.files);
  if (entries.length > options.maxEntries) {
    throw tooManyEntriesError();
  }

  const maxAllowedBytes =
    options.maxRatioBytes !== undefined
      ? Math.min(options.maxExpandedBytes, options.maxRatioBytes)
      : options.maxExpandedBytes;

  let declaredTotal = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const declaredBytes = readDeclaredEntrySize(entry, expandedBytesError);
    declaredTotal += declaredBytes;
    if (declaredBytes > maxAllowedBytes || declaredTotal > maxAllowedBytes) {
      throw expandedBytesError();
    }
  }

  let inflatedTotal = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    inflatedTotal = await streamEntryInflatedBytes(
      entry,
      inflatedTotal,
      maxAllowedBytes,
      expandedBytesError,
      options.onUnreadable,
    );
  }

  return zip;
}

export async function loadOoxmlWorkbook(
  bytes: Uint8Array | ArrayBuffer,
  options: OoxmlArchiveBudgetOptions,
): Promise<ExcelJS.Workbook> {
  await assertOoxmlArchiveLimits(bytes, options);
  const { default: ExcelJSModule } = await import("exceljs");
  const workbook = new ExcelJSModule.Workbook();
  try {
    await workbook.xlsx.load(toExactArrayBuffer(bytes));
  } catch (error) {
    if (options.onUnreadable) throw options.onUnreadable();
    throw error;
  }
  return workbook;
}
