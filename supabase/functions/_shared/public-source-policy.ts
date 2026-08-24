import { decodeHTML } from "entities";
import { DecodingMode, EntityDecoder, htmlDecodeTree } from "entities/decode";

export type ForbiddenPublicSourceIdentity = "healthdirect" | "etg_complete" | "australian_medicines_handbook";

export type PublicSourceWorkerPolicyViolation = "protected_source_identity" | "public_source_policy_invalid";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const acceptedSourcePolicyDigest = "sha256:02dcc095258338d0c355af79dfa1889c024f25f385b553e5b6c802207546855d";
const protectedCatalogueKeys = new Set(["healthdirect", "etg-complete", "australian-medicines-handbook"]);

const enum ProtectedIdentityMatch {
  Healthdirect = 1,
  EtgComplete = 2,
  AustralianMedicinesHandbook = 4,
}

const enum HtmlLexicalMode {
  Text,
  TagOpen,
  Tag,
  SingleQuotedTag,
  DoubleQuotedTag,
  MarkupDeclaration,
  CommentStartDash,
  Comment,
  CommentDash,
  CommentDoubleDash,
}

const healthdirectPattern = "healthdirect";
const therapeuticGuidelinePattern = "therapeuticguideline";
const australianMedicinesHandbookPattern = "australianmedicineshandbook";
const etgPattern = "etg";
const amhPattern = "amh";

function patternPrefixTable(pattern: string): readonly number[] {
  const table = new Array<number>(pattern.length).fill(0);
  for (let index = 1, prefix = 0; index < pattern.length; index += 1) {
    while (prefix > 0 && pattern[index] !== pattern[prefix]) prefix = table[prefix - 1] ?? 0;
    if (pattern[index] === pattern[prefix]) prefix += 1;
    table[index] = prefix;
  }
  return table;
}

const healthdirectPrefixTable = patternPrefixTable(healthdirectPattern);
const therapeuticGuidelinePrefixTable = patternPrefixTable(therapeuticGuidelinePattern);
const australianMedicinesHandbookPrefixTable = patternPrefixTable(australianMedicinesHandbookPattern);

export type ProtectedPublicSourceScannerSnapshot = Readonly<{
  lexicalMode: number;
  entityActive: boolean;
  entityConsumed: number;
  pendingEntityHighSurrogate: number;
  healthdirectPrefix: number;
  therapeuticGuidelinePrefix: number;
  australianMedicinesHandbookPrefix: number;
  tokenLength: number;
  etgTokenPrefix: number;
  amhTokenPrefix: number;
  matches: number;
  finished: boolean;
}>;

export type ProtectedPublicSourceScanner = Readonly<{
  write(value: string): void;
  identity(): ForbiddenPublicSourceIdentity | null;
  finish(): ForbiddenPublicSourceIdentity | null;
  snapshot(): ProtectedPublicSourceScannerSnapshot;
}>;

function advancePattern(pattern: string, prefixTable: readonly number[], prefix: number, character: string): number {
  while (prefix > 0 && pattern[prefix] !== character) prefix = prefixTable[prefix - 1] ?? 0;
  if (pattern[prefix] === character) prefix += 1;
  return prefix;
}

function isIgnoredFormattingCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff
  );
}

class IncrementalProtectedPublicSourceScanner {
  private lexicalMode = HtmlLexicalMode.Text;
  private entityActive = false;
  private entityConsumed = 0;
  private pendingEntityHighSurrogate = 0;
  private healthdirectPrefix = 0;
  private therapeuticGuidelinePrefix = 0;
  private australianMedicinesHandbookPrefix = 0;
  private tokenLength = 0;
  private etgTokenPrefix = 0;
  private amhTokenPrefix = 0;
  private matches = 0;
  private finished = false;
  private readonly entityDecoder = new EntityDecoder(htmlDecodeTree, (codePoint) => {
    this.emitDecodedEntityCodeUnit(codePoint);
  });

  write(value: string): void {
    if (this.finished) throw new Error("protected_identity_scanner_finished");
    let index = 0;
    while (index < value.length) {
      const codePoint = value.codePointAt(index);
      if (codePoint === undefined) break;
      const character = String.fromCodePoint(codePoint);
      if (this.entityActive) {
        const consumedBefore = this.entityConsumed;
        const consumed = this.entityDecoder.write(character, 0);
        if (consumed < 0) {
          this.entityConsumed += character.length;
          index += character.length;
          continue;
        }
        this.entityActive = false;
        this.entityConsumed = 0;
        if (consumed === 0) this.emitBoundary();
        if (consumed > consumedBefore) index += character.length;
        continue;
      }
      index += character.length;
      this.consumeRawCodePoint(codePoint);
    }
  }

  identity(): ForbiddenPublicSourceIdentity | null {
    if ((this.matches & ProtectedIdentityMatch.Healthdirect) !== 0) return "healthdirect";
    if ((this.matches & ProtectedIdentityMatch.EtgComplete) !== 0) return "etg_complete";
    if ((this.matches & ProtectedIdentityMatch.AustralianMedicinesHandbook) !== 0) {
      return "australian_medicines_handbook";
    }
    return null;
  }

  finish(): ForbiddenPublicSourceIdentity | null {
    if (!this.finished) {
      if (this.entityActive) {
        const consumed = this.entityDecoder.end();
        if (consumed === 0) this.emitBoundary();
        this.entityActive = false;
        this.entityConsumed = 0;
      }
      if (this.pendingEntityHighSurrogate !== 0) {
        this.pendingEntityHighSurrogate = 0;
        this.emitBoundary();
      }
      this.finishToken();
      this.finished = true;
    }
    return this.identity();
  }

  snapshot(): ProtectedPublicSourceScannerSnapshot {
    return {
      lexicalMode: this.lexicalMode,
      entityActive: this.entityActive,
      entityConsumed: this.entityConsumed,
      pendingEntityHighSurrogate: this.pendingEntityHighSurrogate,
      healthdirectPrefix: this.healthdirectPrefix,
      therapeuticGuidelinePrefix: this.therapeuticGuidelinePrefix,
      australianMedicinesHandbookPrefix: this.australianMedicinesHandbookPrefix,
      tokenLength: this.tokenLength,
      etgTokenPrefix: this.etgTokenPrefix,
      amhTokenPrefix: this.amhTokenPrefix,
      matches: this.matches,
      finished: this.finished,
    };
  }

  private consumeRawCodePoint(codePoint: number): void {
    if (this.lexicalMode === HtmlLexicalMode.Comment) {
      if (codePoint === 0x2d) this.lexicalMode = HtmlLexicalMode.CommentDash;
      return;
    }
    if (this.lexicalMode === HtmlLexicalMode.CommentDash) {
      this.lexicalMode = codePoint === 0x2d ? HtmlLexicalMode.CommentDoubleDash : HtmlLexicalMode.Comment;
      return;
    }
    if (this.lexicalMode === HtmlLexicalMode.CommentDoubleDash) {
      if (codePoint === 0x3e) {
        this.lexicalMode = HtmlLexicalMode.Text;
        this.emitBoundary();
      } else if (codePoint !== 0x2d) {
        this.lexicalMode = HtmlLexicalMode.Comment;
      }
      return;
    }
    if (this.lexicalMode === HtmlLexicalMode.CommentStartDash) {
      this.lexicalMode = codePoint === 0x2d ? HtmlLexicalMode.Comment : HtmlLexicalMode.Tag;
      return;
    }
    if (this.lexicalMode === HtmlLexicalMode.MarkupDeclaration) {
      if (codePoint === 0x2d) this.lexicalMode = HtmlLexicalMode.CommentStartDash;
      else if (codePoint === 0x3e) this.lexicalMode = HtmlLexicalMode.Text;
      else this.lexicalMode = HtmlLexicalMode.Tag;
      return;
    }
    if (this.lexicalMode === HtmlLexicalMode.TagOpen) {
      if (codePoint === 0x21) this.lexicalMode = HtmlLexicalMode.MarkupDeclaration;
      else if (codePoint === 0x27) this.lexicalMode = HtmlLexicalMode.SingleQuotedTag;
      else if (codePoint === 0x22) this.lexicalMode = HtmlLexicalMode.DoubleQuotedTag;
      else if (codePoint === 0x3e) this.lexicalMode = HtmlLexicalMode.Text;
      else this.lexicalMode = HtmlLexicalMode.Tag;
      return;
    }
    if (this.lexicalMode === HtmlLexicalMode.SingleQuotedTag) {
      if (codePoint === 0x27) this.lexicalMode = HtmlLexicalMode.Tag;
      return;
    }
    if (this.lexicalMode === HtmlLexicalMode.DoubleQuotedTag) {
      if (codePoint === 0x22) this.lexicalMode = HtmlLexicalMode.Tag;
      return;
    }
    if (this.lexicalMode === HtmlLexicalMode.Tag) {
      if (codePoint === 0x27) this.lexicalMode = HtmlLexicalMode.SingleQuotedTag;
      else if (codePoint === 0x22) this.lexicalMode = HtmlLexicalMode.DoubleQuotedTag;
      else if (codePoint === 0x3e) {
        this.lexicalMode = HtmlLexicalMode.Text;
        this.emitBoundary();
      }
      return;
    }
    if (codePoint === 0x3c) {
      this.lexicalMode = HtmlLexicalMode.TagOpen;
      this.emitBoundary();
      return;
    }
    if (codePoint === 0x26) {
      this.entityDecoder.startEntity(DecodingMode.Legacy);
      this.entityActive = true;
      this.entityConsumed = 1;
      return;
    }
    this.emitCanonicalCodePoint(codePoint);
  }

  private emitDecodedEntityCodeUnit(codeUnit: number): void {
    if (this.pendingEntityHighSurrogate !== 0) {
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        const codePoint = 0x10000 + ((this.pendingEntityHighSurrogate - 0xd800) << 10) + (codeUnit - 0xdc00);
        this.pendingEntityHighSurrogate = 0;
        this.emitCanonicalCodePoint(codePoint);
        return;
      }
      this.pendingEntityHighSurrogate = 0;
      this.emitBoundary();
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      this.pendingEntityHighSurrogate = codeUnit;
      return;
    }
    this.emitCanonicalCodePoint(codeUnit);
  }

  private emitCanonicalCodePoint(codePoint: number): void {
    if (isIgnoredFormattingCodePoint(codePoint)) return;
    const normalized = String.fromCodePoint(codePoint).normalize("NFKC").toLocaleLowerCase("en-AU");
    for (const character of normalized) {
      const normalizedCodePoint = character.codePointAt(0) ?? 0;
      if (
        (normalizedCodePoint >= 0x61 && normalizedCodePoint <= 0x7a) ||
        (normalizedCodePoint >= 0x30 && normalizedCodePoint <= 0x39)
      ) {
        this.emitAlphanumeric(character);
      } else if (!isIgnoredFormattingCodePoint(normalizedCodePoint)) {
        this.emitBoundary();
      }
    }
  }

  private emitAlphanumeric(character: string): void {
    this.healthdirectPrefix = advancePattern(
      healthdirectPattern,
      healthdirectPrefixTable,
      this.healthdirectPrefix,
      character,
    );
    if (this.healthdirectPrefix === healthdirectPattern.length) {
      this.matches |= ProtectedIdentityMatch.Healthdirect;
      this.healthdirectPrefix = healthdirectPrefixTable[this.healthdirectPrefix - 1] ?? 0;
    }

    this.therapeuticGuidelinePrefix = advancePattern(
      therapeuticGuidelinePattern,
      therapeuticGuidelinePrefixTable,
      this.therapeuticGuidelinePrefix,
      character,
    );
    if (this.therapeuticGuidelinePrefix === therapeuticGuidelinePattern.length) {
      this.matches |= ProtectedIdentityMatch.EtgComplete;
      this.therapeuticGuidelinePrefix = therapeuticGuidelinePrefixTable[this.therapeuticGuidelinePrefix - 1] ?? 0;
    }

    this.australianMedicinesHandbookPrefix = advancePattern(
      australianMedicinesHandbookPattern,
      australianMedicinesHandbookPrefixTable,
      this.australianMedicinesHandbookPrefix,
      character,
    );
    if (this.australianMedicinesHandbookPrefix === australianMedicinesHandbookPattern.length) {
      this.matches |= ProtectedIdentityMatch.AustralianMedicinesHandbook;
      this.australianMedicinesHandbookPrefix =
        australianMedicinesHandbookPrefixTable[this.australianMedicinesHandbookPrefix - 1] ?? 0;
    }

    this.tokenLength = Math.min(this.tokenLength + 1, etgPattern.length + 1);
    this.etgTokenPrefix =
      this.etgTokenPrefix >= 0 && etgPattern[this.etgTokenPrefix] === character ? this.etgTokenPrefix + 1 : -1;
    this.amhTokenPrefix =
      this.amhTokenPrefix >= 0 && amhPattern[this.amhTokenPrefix] === character ? this.amhTokenPrefix + 1 : -1;
  }

  private emitBoundary(): void {
    this.finishToken();
    this.tokenLength = 0;
    this.etgTokenPrefix = 0;
    this.amhTokenPrefix = 0;
  }

  private finishToken(): void {
    if (this.tokenLength === etgPattern.length && this.etgTokenPrefix === etgPattern.length) {
      this.matches |= ProtectedIdentityMatch.EtgComplete;
    }
    if (this.tokenLength === amhPattern.length && this.amhTokenPrefix === amhPattern.length) {
      this.matches |= ProtectedIdentityMatch.AustralianMedicinesHandbook;
    }
  }
}

export function createProtectedPublicSourceScanner(): ProtectedPublicSourceScanner {
  const scanner = new IncrementalProtectedPublicSourceScanner();
  return Object.freeze({
    write: (value: string) => scanner.write(value),
    identity: () => scanner.identity(),
    finish: () => scanner.finish(),
    snapshot: () => scanner.snapshot(),
  });
}

function decodeNumericHtmlCharacterReference(value: string, hexadecimal: boolean): string {
  const codePoint = Number.parseInt(value, hexadecimal ? 16 : 10);
  const invalidScalar =
    !Number.isSafeInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff);
  const unsafeControl =
    (codePoint >= 0x0001 && codePoint <= 0x0008) ||
    codePoint === 0x000b ||
    codePoint === 0x000c ||
    (codePoint >= 0x000e && codePoint <= 0x001f) ||
    (codePoint >= 0x007f && codePoint <= 0x009f);
  return invalidScalar || unsafeControl ? " " : String.fromCodePoint(codePoint);
}

export function replaceHtmlCharacterReferencesWithBoundaries(input: string): string {
  let output = "";
  let index = 0;
  while (index < input.length) {
    if (input[index] !== "&") {
      output += input[index];
      index += 1;
      continue;
    }

    if (input[index + 1] === "#") {
      let cursor = index + 2;
      const hexadecimal = input[cursor]?.toLowerCase() === "x";
      if (hexadecimal) cursor += 1;
      const digitsStart = cursor;
      const digitPattern = hexadecimal ? /[0-9a-f]/i : /[0-9]/;
      while (cursor < input.length && digitPattern.test(input[cursor] ?? "")) cursor += 1;
      if (cursor > digitsStart) {
        const numericValue = input.slice(digitsStart, cursor);
        if (input[cursor] === ";") cursor += 1;
        output += decodeNumericHtmlCharacterReference(numericValue, hexadecimal);
        index = cursor;
        continue;
      }
    }

    output += "&";
    index += 1;
  }
  return decodeHTML(output);
}

export function forbiddenPublicSourceIdentity(value: string): ForbiddenPublicSourceIdentity | null {
  const scanner = createProtectedPublicSourceScanner();
  scanner.write(value);
  return scanner.finish();
}

export function containsForbiddenPublicSourceChunkContent(rows: ReadonlyArray<{ content: string }>): boolean {
  const scanner = createProtectedPublicSourceScanner();
  for (const row of rows) scanner.write(row.content);
  return scanner.finish() !== null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function publicSourcePolicyViolation(
  metadata: Record<string, unknown> | null | undefined,
  containsProtectedSourceContent = false,
): PublicSourceWorkerPolicyViolation | null {
  const value = metadata ?? {};
  const isPublicSource =
    value.corpus_scope === "australian_public" ||
    nonEmptyString(value.source_catalogue_key) ||
    nonEmptyString(value.public_source_lifecycle);
  if (!isPublicSource) return null;
  if (
    containsProtectedSourceContent ||
    nonEmptyString(value.forbidden_source_identity) ||
    (nonEmptyString(value.source_catalogue_key) && protectedCatalogueKeys.has(value.source_catalogue_key))
  ) {
    return "protected_source_identity";
  }
  if (
    value.corpus_scope !== "australian_public" ||
    !nonEmptyString(value.source_catalogue_key) ||
    value.source_policy_version !== "australian-source-policy-v1" ||
    value.source_policy_digest !== acceptedSourcePolicyDigest ||
    value.content_mode !== "indexed_content" ||
    value.licence_policy !== "public_index_permitted" ||
    !["shadow", "approved"].includes(String(value.public_source_lifecycle ?? "")) ||
    value.source_policy_checked !== true ||
    value.content_identity_verdict !== "clear" ||
    value.content_identity_verdict_version !== "public-source-content-identity-v1" ||
    value.content_identity_hash !== value.content_hash ||
    !digestPattern.test(String(value.source_content_hash ?? "")) ||
    !digestPattern.test(String(value.content_hash ?? "")) ||
    !nonEmptyString(value.source_exact_url) ||
    !nonEmptyString(value.source_exact_version) ||
    !digestPattern.test(String(value.licence_evidence_digest ?? ""))
  ) {
    return "public_source_policy_invalid";
  }
  return null;
}
