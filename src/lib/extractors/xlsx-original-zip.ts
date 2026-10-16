import { createHash } from "node:crypto";
import JSZip from "jszip";
import { XlsxSourceProvenanceError } from "./xlsx-extraction-budget";

export const XLSX_SOURCE_LIMITS = {
  receivedBytes: 64 * 1024 * 1024,
  members: 10_000,
  expandedBytes: 512 * 1024 * 1024,
  binaryBytes: 16 * 1024 * 1024,
  xmlParts: 2_048,
  xmlBytes: 8 * 1024 * 1024,
  allXmlBytes: 32 * 1024 * 1024,
  nodes: 1_000_000,
  depth: 128,
  sheets: 256,
  rows: 200_000,
  cells: 2_000_000,
  allocation: 2_000_000,
  pairWork: 2_000_000,
  relationships: 10_000,
  attributes: 64,
  definitions: 200_000,
  names: 4_096,
  features: 10_000,
  strings: 100_000,
  styles: 4_096,
  tokenBytes: 128 * 1024,
  identityBytes: 2_048,
  runs: 1_024,
  pageBytes: 8 * 1024 * 1024,
  provenanceBytes: 32 * 1024 * 1024,
  resultBytes: 64 * 1024 * 1024,
} as const;

export function xlsxInvalid(): never {
  throw new XlsxSourceProvenanceError("XLSX_SOURCE_PROVENANCE_INVALID");
}
export function xlsxIdentityMismatch(): never {
  throw new XlsxSourceProvenanceError("XLSX_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
}
export function xlsxBound(value: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new XlsxSourceProvenanceError("XLSX_EXTRACTION_BUDGET_EXCEEDED");
  return value;
}
export function xlsxSha(value: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let n = index;
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function xlsxCrc32(bytes: Uint8Array, prior = 0) {
  let n = (prior ^ 0xffffffff) >>> 0;
  for (const byte of bytes) n = (crcTable[(n ^ byte) & 255] ^ (n >>> 8)) >>> 0;
  return (n ^ 0xffffffff) >>> 0;
}
export function strictUtf8(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return xlsxInvalid();
  }
}
export function isCanonicalXlsxPart(name: string, directory = false) {
  const body = directory ? name.slice(0, -1) : name;
  return (
    Boolean(body) &&
    Buffer.byteLength(name, "utf8") <= 1_024 &&
    !/[\u0000-\u001f\u007f\\%:?#]/.test(name) &&
    !name.startsWith("/") &&
    (directory ? name.endsWith("/") && !body.endsWith("/") : !name.endsWith("/")) &&
    body.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}
const dispatcherPatterns = [
  /xl\/worksheets\/sheet\d+[.]xml/,
  /xl\/worksheets\/_rels\/sheet\d+[.]xml.rels/,
  /xl\/theme\/[a-zA-Z0-9]+[.]xml/,
  /xl\/drawings\/drawing\d+[.]xml/,
  /xl\/drawings\/_rels\/drawing\d+[.]xml.rels/,
  /xl\/comments\d+[.]xml/,
  /xl\/tables\/table\d+[.]xml/,
  /xl\/drawings\/vmlDrawing\d+[.]vml/,
];
export type OriginalXlsxMember = {
  name: string;
  directory: boolean;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  originalBytesSha256: string;
};
export type OriginalXlsxArchive = {
  zip: JSZip;
  members: OriginalXlsxMember[];
  sourceContentSha256: string;
  expandedBytes: number;
};

/** Parse received central AND local records before JSZip can normalize/overwrite names. */
export function inspectOriginalXlsxZip(buffer: Buffer): OriginalXlsxMember[] {
  xlsxBound(buffer.length, XLSX_SOURCE_LIMITS.receivedBytes);
  const range = (offset: number, size: number) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      offset < 0 ||
      size < 0 ||
      offset + size > buffer.length
    )
      xlsxInvalid();
  };
  const u16 = (offset: number) => {
    range(offset, 2);
    return buffer.readUInt16LE(offset);
  };
  const u32 = (offset: number) => {
    range(offset, 4);
    return buffer.readUInt32LE(offset);
  };
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
    if (u32(offset) === 0x06054b50 && offset + 22 + u16(offset + 20) === buffer.length) {
      if (eocd !== -1) xlsxInvalid();
      eocd = offset;
    }
  }
  if (eocd < 0 || (eocd >= 20 && u32(eocd - 20) === 0x07064b50)) xlsxInvalid();
  const count = u16(eocd + 10),
    centralBytes = u32(eocd + 12),
    centralStart = u32(eocd + 16);
  if (
    u16(eocd + 4) ||
    u16(eocd + 6) ||
    u16(eocd + 8) !== count ||
    count === 0xffff ||
    centralBytes === 0xffffffff ||
    centralStart === 0xffffffff
  )
    xlsxInvalid();
  xlsxBound(count, XLSX_SOURCE_LIMITS.members);
  range(centralStart, centralBytes);
  if (centralStart + centralBytes !== eocd) xlsxInvalid();
  const extras = (offset: number, length: number, rawName: Buffer, name: string) => {
    range(offset, length);
    const end = offset + length;
    let unicodeSeen = false;
    while (offset < end) {
      if (offset + 4 > end) xlsxInvalid();
      const id = u16(offset),
        size = u16(offset + 2);
      offset += 4;
      if (offset + size > end || id === 1) xlsxInvalid();
      if (id === 0x7075) {
        if (
          unicodeSeen ||
          size < 5 ||
          buffer[offset] !== 1 ||
          u32(offset + 1) !== xlsxCrc32(rawName) ||
          strictUtf8(buffer.subarray(offset + 5, offset + size)) !== name
        )
          xlsxInvalid();
        unicodeSeen = true;
      }
      offset += size;
    }
  };
  const members: OriginalXlsxMember[] = [],
    extents: Array<[number, number]> = [],
    seen = new Set<string>();
  let offset = centralStart,
    expanded = 0;
  for (let index = 0; index < count; index++) {
    range(offset, 46);
    if (u32(offset) !== 0x02014b50) xlsxInvalid();
    const flags = u16(offset + 8),
      method = u16(offset + 10),
      crc = u32(offset + 16),
      compressed = u32(offset + 20),
      size = u32(offset + 24);
    const nameLength = u16(offset + 28),
      extraLength = u16(offset + 30),
      commentLength = u16(offset + 32),
      local = u32(offset + 42);
    const versionMade = u16(offset + 4),
      external = u32(offset + 38);
    if (
      ![0, 8].includes(method) ||
      flags & ~(method === 0 ? 0x0808 : 0x080e) ||
      u16(offset + 34) ||
      compressed === 0xffffffff ||
      size === 0xffffffff ||
      local === 0xffffffff
    )
      xlsxInvalid();
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > eocd) xlsxInvalid();
    range(offset + 46, nameLength);
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength),
      name = strictUtf8(rawName),
      directory = name.endsWith("/");
    if (!isCanonicalXlsxPart(name, directory) || seen.has(name)) xlsxInvalid();
    seen.add(name);
    if (directory && (size || compressed || crc)) xlsxInvalid();
    if (versionMade >>> 8 === 3) {
      const unixType = (external >>> 16) & 0xf000;
      if (unixType && unixType !== (directory ? 0x4000 : 0x8000)) xlsxInvalid();
    }
    if (Boolean(external & 0x10) !== directory && external & 0x10) xlsxInvalid();
    for (const expression of dispatcherPatterns) {
      const match = name.match(expression);
      if (match && match[0] !== name) xlsxInvalid();
    }
    extras(offset + 46 + nameLength, extraLength, rawName, name);
    range(local, 30);
    if (
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      u16(local + 26) !== nameLength
    )
      xlsxInvalid();
    const localExtra = u16(local + 28),
      start = local + 30 + nameLength + localExtra;
    range(local + 30, nameLength + localExtra);
    if (!buffer.subarray(local + 30, local + 30 + nameLength).equals(rawName)) xlsxInvalid();
    extras(local + 30 + nameLength, localExtra, rawName, name);
    const localValues = [u32(local + 14), u32(local + 18), u32(local + 22)],
      centralValues = [crc, compressed, size];
    if (localValues.some((value, i) => value !== centralValues[i] && (!(flags & 8) || value !== 0))) xlsxInvalid();
    range(start, compressed);
    let end = start + compressed;
    if (flags & 8) {
      const signed = u32(end) === 0x08074b50;
      const descriptor = end + (signed ? 4 : 0);
      if (u32(descriptor) !== crc || u32(descriptor + 4) !== compressed || u32(descriptor + 8) !== size) xlsxInvalid();
      end = descriptor + 12;
    }
    if (end > centralStart || (method === 0 && compressed !== size)) xlsxInvalid();
    extents.push([local, end]);
    expanded = xlsxBound(
      expanded + size,
      Math.min(XLSX_SOURCE_LIMITS.expandedBytes, Math.max(buffer.length * 100, XLSX_SOURCE_LIMITS.binaryBytes)),
    );
    members.push({
      name,
      directory,
      compressionMethod: method,
      compressedSize: compressed,
      uncompressedSize: size,
      crc32: crc,
      originalBytesSha256: "",
    });
    offset = recordEnd;
  }
  if (offset !== eocd) xlsxInvalid();
  extents.sort((a, b) => a[0] - b[0]);
  let accounted = 0;
  for (const [start, end] of extents) {
    if (start !== accounted || end < start) xlsxInvalid();
    accounted = end;
  }
  if (accounted !== centralStart) xlsxInvalid();
  return members;
}

export async function openOriginalXlsxArchive(buffer: Buffer): Promise<OriginalXlsxArchive> {
  const members = inspectOriginalXlsxZip(buffer);
  try {
    const zip = await JSZip.loadAsync(buffer, { createFolders: false });
    if (Object.keys(zip.files).length !== members.length) xlsxIdentityMismatch();
    for (const member of members) {
      const entry = zip.files[member.name];
      const data = entry as unknown as {
        _data?: { compressedSize: number; uncompressedSize: number };
        unsafeOriginalName?: string;
      };
      if (
        !entry ||
        entry.name !== member.name ||
        entry.dir !== member.directory ||
        (!entry.dir && data.unsafeOriginalName !== member.name) ||
        (!entry.dir &&
          (!data._data ||
            data._data.compressedSize !== member.compressedSize ||
            data._data.uncompressedSize !== member.uncompressedSize))
      )
        xlsxIdentityMismatch();
    }
    return {
      zip,
      members,
      sourceContentSha256: xlsxSha(buffer),
      expandedBytes: members.reduce((sum, member) => sum + member.uncompressedSize, 0),
    };
  } catch (error) {
    if (error instanceof XlsxSourceProvenanceError) throw error;
    return xlsxInvalid();
  }
}

/** Check each stream before append; binaries are hashed/CRC-checked and discarded. */
export async function readOriginalXlsxMember(archive: OriginalXlsxArchive, member: OriginalXlsxMember, xml: boolean) {
  const maximum = xml ? XLSX_SOURCE_LIMITS.xmlBytes : XLSX_SOURCE_LIMITS.binaryBytes;
  xlsxBound(member.uncompressedSize, maximum);
  if (member.directory) {
    member.originalBytesSha256 = xlsxSha(new Uint8Array());
    return Buffer.alloc(0);
  }
  return new Promise<Buffer>((resolve, reject) => {
    let size = 0,
      crc = 0,
      done = false;
    const digest = createHash("sha256"),
      chunks: Buffer[] = [];
    // JSZip 3.10.2 implements this on ZipObject.prototype; its object typings omit it.
    const entry = archive.zip.files[member.name] as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    };
    if (typeof entry.internalStream !== "function")
      return reject(new XlsxSourceProvenanceError("XLSX_SOURCE_PROVENANCE_INVALID"));
    const stream = entry.internalStream("uint8array");
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      stream.pause();
      reject(
        error instanceof XlsxSourceProvenanceError
          ? error
          : new XlsxSourceProvenanceError("XLSX_SOURCE_PROVENANCE_INVALID"),
      );
    };
    stream.on("data", (chunk: Uint8Array) => {
      if (done) return;
      try {
        size = xlsxBound(size + chunk.byteLength, maximum);
        if (size > member.uncompressedSize) xlsxInvalid();
        crc = xlsxCrc32(chunk, crc);
        digest.update(chunk);
        if (xml) chunks.push(Buffer.from(chunk));
      } catch (error) {
        fail(error);
      }
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (done) return;
      if (size !== member.uncompressedSize || crc !== member.crc32)
        return fail(new XlsxSourceProvenanceError("XLSX_SOURCE_PROVENANCE_INVALID"));
      done = true;
      member.originalBytesSha256 = `sha256:${digest.digest("hex")}`;
      resolve(xml ? Buffer.concat(chunks, size) : Buffer.alloc(0));
    });
    stream.resume();
  });
}

/** Exact UTF-8 JSON size accounting before allocating the serialized string. */
export function boundedXlsxJson(value: unknown, maximum: number) {
  let bytes = 0;
  const add = (n: number) => {
    bytes = xlsxBound(bytes + n, maximum);
  };
  const string = (token: string) => {
    add(2);
    for (let i = 0; i < token.length; i++) {
      const code = token.charCodeAt(i);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) add(2);
      else if (code < 32) add(6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        token.charCodeAt(i + 1) >= 0xdc00 &&
        token.charCodeAt(i + 1) <= 0xdfff
      ) {
        add(4);
        i++;
      } else if (code >= 0xd800 && code <= 0xdfff) add(6);
      else add(3);
    }
  };
  const ancestors = new Set<object>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 128) xlsxInvalid();
    if (typeof item === "string") return string(item);
    if (item === null) return add(4);
    if (typeof item === "boolean") return add(item ? 4 : 5);
    if (typeof item === "number" && Number.isFinite(item)) return add(String(item).length);
    if (!item || typeof item !== "object" || ancestors.has(item)) xlsxInvalid();
    ancestors.add(item);
    add(2);
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) {
        if (index) add(1);
        visit(item[index], depth + 1);
      }
    } else {
      let index = 0;
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        if (index++) add(1);
        string(key);
        add(1);
        visit((item as Record<string, unknown>)[key], depth + 1);
      }
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") !== bytes) xlsxInvalid();
  return serialized;
}
