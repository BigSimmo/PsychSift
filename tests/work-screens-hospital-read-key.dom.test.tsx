import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useHospitalReadKey } from "@/components/work-screens/hospital/hospital-shared";

// A hospital read's answer is shown only while its key still matches. Going from
// hospital A to B and back to A must never reuse A's earlier key, or A's old rows
// (including doctors who have since stopped sharing) would show while the fresh read loads.
describe("useHospitalReadKey", () => {
  it("never repeats a key when the hospital goes A, B, then back to A", () => {
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useHospitalReadKey(id, 0), {
      initialProps: { id: "a" as string | null },
    });
    const first = result.current;
    rerender({ id: "b" });
    const second = result.current;
    rerender({ id: "a" });
    const third = result.current;
    expect(new Set([first, second, third]).size).toBe(3);
    expect(third).not.toBe(first);
  });

  it("stays put while the hospital is unchanged, and moves on retry", () => {
    const { result, rerender } = renderHook(({ attempt }: { attempt: number }) => useHospitalReadKey("a", attempt), {
      initialProps: { attempt: 0 },
    });
    const first = result.current;
    rerender({ attempt: 0 });
    expect(result.current).toBe(first);
    rerender({ attempt: 1 });
    expect(result.current).not.toBe(first);
  });
});

describe("useHospitalReadKey with the work zone in the identity", () => {
  it("never repeats a key when the zone goes A, B, then back to A", () => {
    const { result, rerender } = renderHook(({ zone }: { zone: string }) => useHospitalReadKey(`h1|${zone}`, 0), {
      initialProps: { zone: "Australia/Perth" },
    });
    const first = result.current;
    rerender({ zone: "Australia/Sydney" });
    const second = result.current;
    rerender({ zone: "Australia/Perth" });
    expect(new Set([first, second, result.current]).size).toBe(3);
  });
});
