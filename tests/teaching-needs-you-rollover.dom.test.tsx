import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/teaching/use-teaching-resource", () => ({
  useTeachingResource: () => ({ data: null, status: "idle" }),
}));

import { NeedsYou } from "@/components/teaching/teaching-needs-you";

afterEach(cleanup);

/* The made-up presenter's talk is Tue 6 Oct 2026 at 14:00 Perth. Once it has ended, Needs you
   asks for the next club's preparation, the same talk Presenting and the hero name. */
describe("Needs you after the example talk", () => {
  it("asks for next week's talk, not today's ended one", () => {
    render(<NeedsYou live={false} today="2026-10-06" now={new Date("2026-10-06T07:00:00Z")} />);
    expect(screen.getByText(/^You present /)).toHaveTextContent("Tue 13 Oct");
  });
});
