import { describe, it, expect } from "vitest";
import { formatBrief, type PursuitRequest } from "./pursuitRequests";

const base: PursuitRequest = {
  id: "req-uuid-1",
  userId: "user-uuid-2",
  sentence: "Track how many times I close the shed door before bed.",
  context: null,
  status: "approved",
  reviewerNotes: null,
  reviewerResponse: null,
  implementedPursuitId: null,
  createdAt: "2026-09-20T00:00:00Z",
  updatedAt: "2026-09-20T00:00:00Z",
};

describe("formatBrief", () => {
  it("renders every field the coordinator's template requires", () => {
    const out = formatBrief(base, new Date("2026-09-23T10:00:00Z"));
    expect(out).toContain("Task from pursuit_requests row req-uuid-1:");
    expect(out).toContain("User (user-uuid-2) requests: Track how many times I close the shed door before bed.");
    expect(out).toContain("Context: (none)");
    expect(out).toContain("Approved by John on 2026-09-23.");
    expect(out).toContain("`implemented_pursuit_id`");
  });
  it("uses the caller's context text when present", () => {
    const out = formatBrief({ ...base, context: "Every night before 10pm." }, new Date("2026-01-05T00:00:00Z"));
    expect(out).toContain("Context: Every night before 10pm.");
    expect(out).toContain("Approved by John on 2026-01-05.");
  });
  it("treats a blank / whitespace-only context as (none)", () => {
    const out = formatBrief({ ...base, context: "   " });
    expect(out).toContain("Context: (none)");
  });
});
