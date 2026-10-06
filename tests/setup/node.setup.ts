import { afterEach, vi } from "vitest";

// Worker thread cleanup for the Node environment. Ensures tests that use fake
// timers, mock implementations, or global stubs do not leak into subsequent
// test files sharing the same worker.
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
