// Opt-in cleanup for suites that recreate spies and global fixtures per test.
// Import this helper in those suites; existing beforeAll fixtures must survive other cases.
import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
