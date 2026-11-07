import type { UniversalSearchGroup, UniversalSearchResponse } from "@/lib/universal-search";

export type UniversalSearchStreamResponse = UniversalSearchResponse & {
  demoMode?: boolean;
  publicAccess?: boolean;
};

export type UniversalSearchStreamEvent =
  | { type: "group"; query: string; group: UniversalSearchGroup }
  | { type: "complete"; response: UniversalSearchStreamResponse }
  | { type: "error"; code: "universal_search_failed" };

type UniversalSearchItem = UniversalSearchGroup["items"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function optionalNumber(value: unknown) {
  return value === undefined || isFiniteNumber(value);
}

function optionalBoolean(value: unknown) {
  return value === undefined || typeof value === "boolean";
}

function parseItem(value: unknown): UniversalSearchItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.kind !== "string") return null;
  if (typeof value.title !== "string") return null;
  if (!optionalString(value.subtitle)) return null;
  if (typeof value.href !== "string") return null;
  if (!optionalNumber(value.score)) return null;
  if (!optionalString(value.badge)) return null;
  if (!optionalString(value.meta)) return null;
  if (!optionalBoolean(value.confident)) return null;
  return value as unknown as UniversalSearchItem;
}

function parseGroup(value: unknown): UniversalSearchGroup | null {
  if (!isRecord(value)) return null;
  if (typeof value.kind !== "string") return null;
  if (!isFiniteNumber(value.total)) return null;
  if (!Array.isArray(value.items)) return null;
  const items = value.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  if (!isFiniteNumber(value.latencyMs)) return null;
  if (!optionalBoolean(value.error)) return null;
  return { ...value, items } as unknown as UniversalSearchGroup;
}

function parseResponse(value: unknown): UniversalSearchStreamResponse | null {
  if (!isRecord(value)) return null;
  if (typeof value.query !== "string") return null;
  if (!Array.isArray(value.groups)) return null;
  const groups = value.groups.map(parseGroup);
  if (groups.some((group) => group === null)) return null;
  if (!isFiniteNumber(value.tookMs)) return null;
  if (
    value.domainOrder !== undefined &&
    (!Array.isArray(value.domainOrder) || value.domainOrder.some((domain) => typeof domain !== "string"))
  ) {
    return null;
  }
  if (!optionalBoolean(value.demoMode)) return null;
  if (!optionalBoolean(value.publicAccess)) return null;
  return { ...value, groups } as unknown as UniversalSearchStreamResponse;
}

function parseEvent(line: string): UniversalSearchStreamEvent {
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(line);
  } catch {
    throw new Error("Invalid universal-search NDJSON event.");
  }
  if (!isRecord(rawJson)) throw new Error("Invalid universal-search NDJSON event.");
  if (rawJson.type === "group") {
    if (typeof rawJson.query !== "string") throw new Error("Invalid universal-search NDJSON event.");
    const group = parseGroup(rawJson.group);
    if (!group) throw new Error("Invalid universal-search NDJSON event.");
    return { type: "group", query: rawJson.query, group };
  }
  if (rawJson.type === "complete") {
    const response = parseResponse(rawJson.response);
    if (!response) throw new Error("Invalid universal-search NDJSON event.");
    return { type: "complete", response };
  }
  if (rawJson.type === "error" && rawJson.code === "universal_search_failed") {
    return { type: "error", code: "universal_search_failed" };
  }
  throw new Error("Invalid universal-search NDJSON event.");
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

/** Consume split NDJSON chunks, surfacing groups immediately and returning final JSON parity. */

export async function consumeUniversalSearchNdjson(
  response: Response,
  options: {
    signal?: AbortSignal;
    onGroup?: (group: UniversalSearchGroup, query: string) => void | Promise<void>;
  } = {},
): Promise<UniversalSearchStreamResponse> {
  throwIfAborted(options.signal);
  if (!response.body) throw new Error("Universal-search NDJSON response has no body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete: UniversalSearchStreamResponse | undefined;
  const cancelReader = () => {
    void reader.cancel(options.signal?.reason).catch(() => undefined);
  };
  options.signal?.addEventListener("abort", cancelReader, { once: true });

  const acceptLine = async (line: string) => {
    if (!line.trim()) return;
    const event = parseEvent(line);
    if (event.type === "group") await options.onGroup?.(event.group, event.query);
    else if (event.type === "complete") complete = event.response;
    else {
      const error = new Error("Universal search failed.");
      void reader.cancel(error).catch(() => undefined);
      throw error;
    }
  };

  try {
    while (true) {
      throwIfAborted(options.signal);
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        await acceptLine(line);
        if (complete) {
          // The protocol's complete frame is authoritative. A server/proxy
          // leaving the connection open must not keep useful results pending.
          void reader.cancel().catch(() => undefined);
          return complete;
        }
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) await acceptLine(buffer);
    throwIfAborted(options.signal);
    if (!complete) throw new Error("Universal-search NDJSON stream ended without a complete event.");
    return complete;
  } catch (error) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }
}
