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
  EndTagOpen,
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
const entityCheckpointLimit = 64;

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
  entitySpeculativeHealthdirectPrefix: number;
  entitySpeculativeTherapeuticGuidelinePrefix: number;
  entitySpeculativeAustralianMedicinesHandbookPrefix: number;
  entitySpeculativeTokenLength: number;
  entitySpeculativeEtgTokenPrefix: number;
  entitySpeculativeAmhTokenPrefix: number;
  entitySpeculativeMatches: number;
  entityCheckpointCount: number;
  entityCheckpointLimit: number;
  markupSpeculativeHealthdirectPrefix: number;
  markupSpeculativeTherapeuticGuidelinePrefix: number;
  markupSpeculativeAustralianMedicinesHandbookPrefix: number;
  markupSpeculativeTokenLength: number;
  markupSpeculativeEtgTokenPrefix: number;
  markupSpeculativeAmhTokenPrefix: number;
  markupSpeculativeMatches: number;
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

type ProtectedMatcherState = {
  healthdirectPrefix: number;
  therapeuticGuidelinePrefix: number;
  australianMedicinesHandbookPrefix: number;
  tokenLength: number;
  etgTokenPrefix: number;
  amhTokenPrefix: number;
  matches: number;
};

function createMatcherState(): ProtectedMatcherState {
  return {
    healthdirectPrefix: 0,
    therapeuticGuidelinePrefix: 0,
    australianMedicinesHandbookPrefix: 0,
    tokenLength: 0,
    etgTokenPrefix: 0,
    amhTokenPrefix: 0,
    matches: 0,
  };
}

function copyMatcherState(target: ProtectedMatcherState, source: ProtectedMatcherState): void {
  target.healthdirectPrefix = source.healthdirectPrefix;
  target.therapeuticGuidelinePrefix = source.therapeuticGuidelinePrefix;
  target.australianMedicinesHandbookPrefix = source.australianMedicinesHandbookPrefix;
  target.tokenLength = source.tokenLength;
  target.etgTokenPrefix = source.etgTokenPrefix;
  target.amhTokenPrefix = source.amhTokenPrefix;
  target.matches = source.matches;
}

function matcherIdentity(state: ProtectedMatcherState): ForbiddenPublicSourceIdentity | null {
  if ((state.matches & ProtectedIdentityMatch.Healthdirect) !== 0) return "healthdirect";
  if ((state.matches & ProtectedIdentityMatch.EtgComplete) !== 0) return "etg_complete";
  if ((state.matches & ProtectedIdentityMatch.AustralianMedicinesHandbook) !== 0) {
    return "australian_medicines_handbook";
  }
  return null;
}

function finishMatcherToken(state: ProtectedMatcherState): void {
  if (state.tokenLength === etgPattern.length && state.etgTokenPrefix === etgPattern.length) {
    state.matches |= ProtectedIdentityMatch.EtgComplete;
  }
  if (state.tokenLength === amhPattern.length && state.amhTokenPrefix === amhPattern.length) {
    state.matches |= ProtectedIdentityMatch.AustralianMedicinesHandbook;
  }
}

function emitMatcherBoundary(state: ProtectedMatcherState): void {
  finishMatcherToken(state);
  state.tokenLength = 0;
  state.etgTokenPrefix = 0;
  state.amhTokenPrefix = 0;
}

function emitMatcherAlphanumeric(state: ProtectedMatcherState, character: string): void {
  state.healthdirectPrefix = advancePattern(
    healthdirectPattern,
    healthdirectPrefixTable,
    state.healthdirectPrefix,
    character,
  );
  if (state.healthdirectPrefix === healthdirectPattern.length) {
    state.matches |= ProtectedIdentityMatch.Healthdirect;
    state.healthdirectPrefix = healthdirectPrefixTable[state.healthdirectPrefix - 1] ?? 0;
  }

  state.therapeuticGuidelinePrefix = advancePattern(
    therapeuticGuidelinePattern,
    therapeuticGuidelinePrefixTable,
    state.therapeuticGuidelinePrefix,
    character,
  );
  if (state.therapeuticGuidelinePrefix === therapeuticGuidelinePattern.length) {
    state.matches |= ProtectedIdentityMatch.EtgComplete;
    state.therapeuticGuidelinePrefix = therapeuticGuidelinePrefixTable[state.therapeuticGuidelinePrefix - 1] ?? 0;
  }

  state.australianMedicinesHandbookPrefix = advancePattern(
    australianMedicinesHandbookPattern,
    australianMedicinesHandbookPrefixTable,
    state.australianMedicinesHandbookPrefix,
    character,
  );
  if (state.australianMedicinesHandbookPrefix === australianMedicinesHandbookPattern.length) {
    state.matches |= ProtectedIdentityMatch.AustralianMedicinesHandbook;
    state.australianMedicinesHandbookPrefix =
      australianMedicinesHandbookPrefixTable[state.australianMedicinesHandbookPrefix - 1] ?? 0;
  }

  state.tokenLength = Math.min(state.tokenLength + 1, etgPattern.length + 1);
  state.etgTokenPrefix =
    state.etgTokenPrefix >= 0 && etgPattern[state.etgTokenPrefix] === character ? state.etgTokenPrefix + 1 : -1;
  state.amhTokenPrefix =
    state.amhTokenPrefix >= 0 && amhPattern[state.amhTokenPrefix] === character ? state.amhTokenPrefix + 1 : -1;
}

function emitMatcherCodePoint(state: ProtectedMatcherState, codePoint: number): void {
  if (isIgnoredFormattingCodePoint(codePoint)) return;
  const normalized = String.fromCodePoint(codePoint).normalize("NFKC").toLocaleLowerCase("en-AU");
  for (const character of normalized) {
    const normalizedCodePoint = character.codePointAt(0) ?? 0;
    if (
      (normalizedCodePoint >= 0x61 && normalizedCodePoint <= 0x7a) ||
      (normalizedCodePoint >= 0x30 && normalizedCodePoint <= 0x39)
    ) {
      emitMatcherAlphanumeric(state, character);
    } else if (!isIgnoredFormattingCodePoint(normalizedCodePoint)) {
      emitMatcherBoundary(state);
    }
  }
}

function isAsciiLetter(codePoint: number): boolean {
  return (codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a);
}

class IncrementalProtectedPublicSourceScanner {
  private lexicalMode = HtmlLexicalMode.Text;
  private entityActive = false;
  private entityConsumed = 0;
  private pendingEntityHighSurrogate = 0;
  private readonly matcherState = createMatcherState();
  private readonly entityBaseState = createMatcherState();
  private readonly entitySpeculativeState = createMatcherState();
  private readonly entityCheckpointStates = Array.from({ length: entityCheckpointLimit }, createMatcherState);
  private readonly entityCheckpointLengths = new Array<number>(entityCheckpointLimit).fill(0);
  private entityCheckpointCount = 0;
  private entityNumeric = false;
  private entityCallbackConsumed = -1;
  private entityCallbackCheckpointIndex = -1;
  private entityCallbackCheckpointWasExisting = false;
  private entityCallbackWritesDecoded = false;
  private readonly markupSpeculativeState = createMatcherState();
  private finished = false;
  private readonly entityDecoder = new EntityDecoder(htmlDecodeTree, (codePoint, consumed) => {
    this.captureDecodedEntityCodeUnit(codePoint, consumed);
  });

  write(value: string): void {
    if (this.finished) throw new Error("protected_identity_scanner_finished");
    let index = 0;
    while (index < value.length) {
      const codePoint = value.codePointAt(index);
      if (codePoint === undefined) break;
      const character = String.fromCodePoint(codePoint);
      let reconsume = true;
      let reconsumeCount = 0;
      while (reconsume) {
        reconsume = false;
        reconsumeCount += 1;
        if (reconsumeCount > 2) throw new Error("protected_identity_lexical_reconsume_limit");
        if (this.entityActive) {
          emitMatcherCodePoint(this.entitySpeculativeState, codePoint);
          this.advanceEntityCheckpoints(codePoint);
          const consumedBefore = this.entityConsumed;
          if (consumedBefore === 1 && codePoint === 0x23) this.entityNumeric = true;
          this.prepareEntityCallback();
          const consumed = this.entityDecoder.write(character, 0);
          if (consumed < 0) {
            this.entityConsumed += character.length;
            if (!this.entityNumeric) this.probeEntityCheckpoint();
            index += character.length;
            continue;
          }
          this.entityActive = false;
          this.entityConsumed = 0;
          if (consumed === 0) {
            copyMatcherState(this.matcherState, this.entitySpeculativeState);
            reconsume = codePoint === 0x26 || codePoint === 0x3c;
            if (!reconsume) index += character.length;
          } else {
            const checkpointIndex = this.findEntityCheckpoint(consumed);
            if (checkpointIndex < 0) throw new Error("protected_identity_entity_checkpoint_missing");
            if (!this.entityCallbackCheckpointWasExisting && consumed < consumedBefore) {
              throw new Error("protected_identity_entity_checkpoint_incomplete");
            }
            copyMatcherState(this.matcherState, this.entityCheckpointStates[checkpointIndex]);
            const currentCodePointWasConsumed = consumed > consumedBefore;
            const currentCodePointStartsNextToken = codePoint === 0x26 || codePoint === 0x3c;
            reconsume =
              !currentCodePointWasConsumed &&
              (!this.entityCallbackCheckpointWasExisting || currentCodePointStartsNextToken);
            if (!reconsume) index += character.length;
          }
        } else {
          reconsume = this.consumeRawCodePoint(codePoint);
          if (!reconsume) index += character.length;
        }
      }
    }
  }

  identity(): ForbiddenPublicSourceIdentity | null {
    return matcherIdentity(this.matcherState);
  }

  finish(): ForbiddenPublicSourceIdentity | null {
    if (!this.finished) {
      if (this.entityActive) {
        this.prepareEntityCallback();
        const consumed = this.entityDecoder.end();
        if (consumed === 0) {
          copyMatcherState(this.matcherState, this.entitySpeculativeState);
        } else {
          const checkpointIndex = this.findEntityCheckpoint(consumed);
          if (checkpointIndex < 0) throw new Error("protected_identity_entity_checkpoint_missing");
          if (!this.entityCallbackCheckpointWasExisting && consumed < this.entityConsumed) {
            throw new Error("protected_identity_entity_checkpoint_incomplete");
          }
          copyMatcherState(this.matcherState, this.entityCheckpointStates[checkpointIndex]);
        }
        this.entityActive = false;
        this.entityConsumed = 0;
      }
      if (this.pendingEntityHighSurrogate !== 0) {
        this.pendingEntityHighSurrogate = 0;
        emitMatcherBoundary(this.matcherState);
      }
      if (this.lexicalMode !== HtmlLexicalMode.Text) {
        copyMatcherState(this.matcherState, this.markupSpeculativeState);
        this.lexicalMode = HtmlLexicalMode.Text;
      }
      finishMatcherToken(this.matcherState);
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
      healthdirectPrefix: this.matcherState.healthdirectPrefix,
      therapeuticGuidelinePrefix: this.matcherState.therapeuticGuidelinePrefix,
      australianMedicinesHandbookPrefix: this.matcherState.australianMedicinesHandbookPrefix,
      tokenLength: this.matcherState.tokenLength,
      etgTokenPrefix: this.matcherState.etgTokenPrefix,
      amhTokenPrefix: this.matcherState.amhTokenPrefix,
      matches: this.matcherState.matches,
      entitySpeculativeHealthdirectPrefix: this.entitySpeculativeState.healthdirectPrefix,
      entitySpeculativeTherapeuticGuidelinePrefix: this.entitySpeculativeState.therapeuticGuidelinePrefix,
      entitySpeculativeAustralianMedicinesHandbookPrefix: this.entitySpeculativeState.australianMedicinesHandbookPrefix,
      entitySpeculativeTokenLength: this.entitySpeculativeState.tokenLength,
      entitySpeculativeEtgTokenPrefix: this.entitySpeculativeState.etgTokenPrefix,
      entitySpeculativeAmhTokenPrefix: this.entitySpeculativeState.amhTokenPrefix,
      entitySpeculativeMatches: this.entitySpeculativeState.matches,
      entityCheckpointCount: this.entityCheckpointCount,
      entityCheckpointLimit,
      markupSpeculativeHealthdirectPrefix: this.markupSpeculativeState.healthdirectPrefix,
      markupSpeculativeTherapeuticGuidelinePrefix: this.markupSpeculativeState.therapeuticGuidelinePrefix,
      markupSpeculativeAustralianMedicinesHandbookPrefix: this.markupSpeculativeState.australianMedicinesHandbookPrefix,
      markupSpeculativeTokenLength: this.markupSpeculativeState.tokenLength,
      markupSpeculativeEtgTokenPrefix: this.markupSpeculativeState.etgTokenPrefix,
      markupSpeculativeAmhTokenPrefix: this.markupSpeculativeState.amhTokenPrefix,
      markupSpeculativeMatches: this.markupSpeculativeState.matches,
      finished: this.finished,
    };
  }

  private consumeRawCodePoint(codePoint: number): boolean {
    if (this.lexicalMode !== HtmlLexicalMode.Text) {
      emitMatcherCodePoint(this.markupSpeculativeState, codePoint);
    }
    if (this.lexicalMode === HtmlLexicalMode.Comment) {
      if (codePoint === 0x2d) this.lexicalMode = HtmlLexicalMode.CommentDash;
      return false;
    }
    if (this.lexicalMode === HtmlLexicalMode.CommentDash) {
      this.lexicalMode = codePoint === 0x2d ? HtmlLexicalMode.CommentDoubleDash : HtmlLexicalMode.Comment;
      return false;
    }
    if (this.lexicalMode === HtmlLexicalMode.CommentDoubleDash) {
      if (codePoint === 0x3e) {
        this.lexicalMode = HtmlLexicalMode.Text;
        emitMatcherBoundary(this.matcherState);
      } else if (codePoint !== 0x2d) {
        this.lexicalMode = HtmlLexicalMode.Comment;
      }
      return false;
    }
    if (this.lexicalMode === HtmlLexicalMode.CommentStartDash) {
      if (codePoint === 0x2d) this.lexicalMode = HtmlLexicalMode.Comment;
      else return this.commitInvalidMarkup(codePoint);
      return false;
    }
    if (this.lexicalMode === HtmlLexicalMode.MarkupDeclaration) {
      if (codePoint === 0x2d) this.lexicalMode = HtmlLexicalMode.CommentStartDash;
      else if (isAsciiLetter(codePoint) || codePoint === 0x5b) this.lexicalMode = HtmlLexicalMode.Tag;
      else return this.commitInvalidMarkup(codePoint);
      return false;
    }
    if (this.lexicalMode === HtmlLexicalMode.EndTagOpen) {
      if (isAsciiLetter(codePoint)) this.lexicalMode = HtmlLexicalMode.Tag;
      else return this.commitInvalidMarkup(codePoint);
      return false;
    }
    if (this.lexicalMode === HtmlLexicalMode.TagOpen) {
      if (codePoint === 0x21) this.lexicalMode = HtmlLexicalMode.MarkupDeclaration;
      else if (codePoint === 0x2f) this.lexicalMode = HtmlLexicalMode.EndTagOpen;
      else if (codePoint === 0x3f || isAsciiLetter(codePoint)) this.lexicalMode = HtmlLexicalMode.Tag;
      else return this.commitInvalidMarkup(codePoint);
      return false;
    }
    if (this.lexicalMode === HtmlLexicalMode.SingleQuotedTag) {
      if (codePoint === 0x27) this.lexicalMode = HtmlLexicalMode.Tag;
      return false;
    }
    if (this.lexicalMode === HtmlLexicalMode.DoubleQuotedTag) {
      if (codePoint === 0x22) this.lexicalMode = HtmlLexicalMode.Tag;
      return false;
    }
    if (this.lexicalMode === HtmlLexicalMode.Tag) {
      if (codePoint === 0x27) this.lexicalMode = HtmlLexicalMode.SingleQuotedTag;
      else if (codePoint === 0x22) this.lexicalMode = HtmlLexicalMode.DoubleQuotedTag;
      else if (codePoint === 0x3e) {
        this.lexicalMode = HtmlLexicalMode.Text;
        emitMatcherBoundary(this.matcherState);
      }
      return false;
    }
    if (codePoint === 0x3c) {
      copyMatcherState(this.markupSpeculativeState, this.matcherState);
      emitMatcherBoundary(this.markupSpeculativeState);
      this.lexicalMode = HtmlLexicalMode.TagOpen;
      return false;
    }
    if (codePoint === 0x26) {
      copyMatcherState(this.entityBaseState, this.matcherState);
      copyMatcherState(this.entitySpeculativeState, this.matcherState);
      emitMatcherBoundary(this.entitySpeculativeState);
      this.entityCheckpointCount = 0;
      this.entityNumeric = false;
      this.entityDecoder.startEntity(DecodingMode.Legacy);
      this.entityActive = true;
      this.entityConsumed = 1;
      return false;
    }
    emitMatcherCodePoint(this.matcherState, codePoint);
    return false;
  }

  private commitInvalidMarkup(codePoint: number): boolean {
    copyMatcherState(this.matcherState, this.markupSpeculativeState);
    this.lexicalMode = HtmlLexicalMode.Text;
    return codePoint === 0x26 || codePoint === 0x3c;
  }

  private prepareEntityCallback(): void {
    this.entityCallbackConsumed = -1;
    this.entityCallbackCheckpointIndex = -1;
    this.entityCallbackCheckpointWasExisting = false;
    this.entityCallbackWritesDecoded = false;
  }

  private findEntityCheckpoint(consumed: number): number {
    for (let index = 0; index < this.entityCheckpointCount; index += 1) {
      if (this.entityCheckpointLengths[index] === consumed) return index;
    }
    return -1;
  }

  private createEntityCheckpoint(consumed: number): number {
    if (this.entityCheckpointCount >= entityCheckpointLimit) {
      throw new Error("protected_identity_entity_checkpoint_limit");
    }
    const index = this.entityCheckpointCount;
    this.entityCheckpointCount += 1;
    this.entityCheckpointLengths[index] = consumed;
    copyMatcherState(this.entityCheckpointStates[index], this.entityBaseState);
    return index;
  }

  private advanceEntityCheckpoints(codePoint: number): void {
    for (let index = 0; index < this.entityCheckpointCount; index += 1) {
      emitMatcherCodePoint(this.entityCheckpointStates[index], codePoint);
    }
  }

  private probeEntityCheckpoint(): void {
    this.prepareEntityCallback();
    const consumed = this.entityDecoder.end();
    if (consumed <= 0) return;
    const checkpointIndex = this.findEntityCheckpoint(consumed);
    if (checkpointIndex < 0) throw new Error("protected_identity_entity_checkpoint_missing");
    if (!this.entityCallbackCheckpointWasExisting && consumed < this.entityConsumed) {
      throw new Error("protected_identity_entity_checkpoint_incomplete");
    }
  }

  private captureDecodedEntityCodeUnit(codeUnit: number, consumed: number): void {
    if (this.entityCallbackConsumed !== consumed) {
      this.entityCallbackConsumed = consumed;
      const existingCheckpoint = this.findEntityCheckpoint(consumed);
      this.entityCallbackCheckpointWasExisting = existingCheckpoint >= 0;
      this.entityCallbackCheckpointIndex =
        existingCheckpoint >= 0 ? existingCheckpoint : this.createEntityCheckpoint(consumed);
      this.entityCallbackWritesDecoded = existingCheckpoint < 0;
      if (this.entityCallbackWritesDecoded) this.pendingEntityHighSurrogate = 0;
    }
    if (!this.entityCallbackWritesDecoded) return;
    this.emitDecodedEntityCodeUnit(this.entityCheckpointStates[this.entityCallbackCheckpointIndex], codeUnit);
  }

  private emitDecodedEntityCodeUnit(state: ProtectedMatcherState, codeUnit: number): void {
    if (this.pendingEntityHighSurrogate !== 0) {
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        const codePoint = 0x10000 + ((this.pendingEntityHighSurrogate - 0xd800) << 10) + (codeUnit - 0xdc00);
        this.pendingEntityHighSurrogate = 0;
        emitMatcherCodePoint(state, codePoint);
        return;
      }
      this.pendingEntityHighSurrogate = 0;
      emitMatcherBoundary(state);
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      this.pendingEntityHighSurrogate = codeUnit;
      return;
    }
    emitMatcherCodePoint(state, codeUnit);
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
