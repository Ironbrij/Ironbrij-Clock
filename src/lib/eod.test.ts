import { describe, expect, it } from "vitest";
import { buildEodText } from "./eod";

type Entry = Parameters<typeof buildEodText>[1][number];
type Project = NonNullable<ReturnType<Parameters<typeof buildEodText>[2]>>;

const DAY = new Date(2026, 9, 20);

const projects: Record<string, Project> = {
  acme: { name: "Acme Website", client: "Acme Co", clientId: "c-acme" },
  bright: { name: "Bright Social", client: "Bright Dental", clientId: "c-bright" },
  internal: { name: "Ironbrij Internal", client: "Internal — no client", clientId: null },
};
const projectById = (id: string | null) => (id ? projects[id] : undefined);

const entry = (over: Partial<Entry> = {}): Entry => ({
  date: "2026-10-20",
  startTime: "2026-10-20T09:00:00",
  projectId: "acme",
  task: "Design",
  description: "Homepage design",
  ...over,
});

describe("buildEodText", () => {
  it("lists the day's tasks in the order they happened, under a dated header", () => {
    const text = buildEodText(
      DAY,
      [
        entry({
          startTime: "2026-10-20T11:00:00",
          description: "Instagram posts",
          projectId: "bright",
        }),
        entry({ startTime: "2026-10-20T09:00:00", description: "Homepage design" }),
        entry({ startTime: "2026-10-20T10:20:00", description: "Client call" }),
      ],
      projectById,
    );
    expect(text).toBe(
      [
        "EOD – Tuesday 20 October",
        "",
        "• Homepage design – Acme Co",
        "• Client call – Acme Co",
        "• Instagram posts – Bright Dental",
      ].join("\n"),
    );
  });

  it("leaves the client off when the project has none", () => {
    const text = buildEodText(
      DAY,
      [entry({ description: "Team meeting", projectId: "internal" })],
      projectById,
    );
    expect(text?.split("\n").at(-1)).toBe("• Team meeting");
  });

  it("falls back to the task category, then the project, when there's no description", () => {
    const text = buildEodText(
      DAY,
      [
        entry({ startTime: "2026-10-20T09:00:00", description: "  ", task: "Copywriting" }),
        entry({ startTime: "2026-10-20T10:00:00", description: "", task: "", projectId: "bright" }),
        entry({ startTime: "2026-10-20T11:00:00", description: "", task: "", projectId: null }),
      ],
      projectById,
    );
    expect(text?.split("\n").slice(2)).toEqual([
      "• Copywriting – Acme Co",
      "• Bright Social – Bright Dental",
      "• No description",
    ]);
  });

  it("lists a task worked on more than once a single time", () => {
    const text = buildEodText(
      DAY,
      [
        entry({ startTime: "2026-10-20T09:00:00", description: "Homepage design" }),
        entry({ startTime: "2026-10-20T10:00:00", description: "Client call" }),
        entry({ startTime: "2026-10-20T13:00:00", description: "homepage design " }),
      ],
      projectById,
    );
    expect(text?.split("\n").slice(2)).toEqual([
      "• Homepage design – Acme Co",
      "• Client call – Acme Co",
    ]);
  });

  it("keeps the same task for two different clients as two lines", () => {
    const text = buildEodText(
      DAY,
      [
        entry({ startTime: "2026-10-20T09:00:00", description: "Weekly report" }),
        entry({
          startTime: "2026-10-20T10:00:00",
          description: "Weekly report",
          projectId: "bright",
        }),
      ],
      projectById,
    );
    expect(text?.split("\n").slice(2)).toEqual([
      "• Weekly report – Acme Co",
      "• Weekly report – Bright Dental",
    ]);
  });

  it("only includes entries from the day asked for", () => {
    const text = buildEodText(
      DAY,
      [
        entry({ description: "Today's task" }),
        entry({ date: "2026-10-19", description: "Yesterday's task" }),
      ],
      projectById,
    );
    expect(text).not.toContain("Yesterday's task");
    expect(text).toContain("Today's task");
  });

  it("is null for a day with nothing logged, so there's nothing to copy", () => {
    expect(buildEodText(DAY, [], projectById)).toBeNull();
    expect(buildEodText(DAY, [entry({ date: "2026-10-19" })], projectById)).toBeNull();
  });
});
