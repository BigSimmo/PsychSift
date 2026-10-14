// Global cleanup for the Node project (registered as a setupFile in vitest.config.mts).
// Spies and stubbed globals are restored after every test, so create them per test
// (beforeEach or inside the test), not in beforeAll or at module scope.
import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
