import { describe, expect, it } from "vitest";
import { buildWorkBreakdown } from "./work-breakdown";

type Entry = Parameters<typeof buildWorkBreakdown>[0][number];
type Project = NonNullable<ReturnType<Parameters<typeof buildWorkBreakdown>[1]>>;

const projects: Record<string, Project> = {
  acmeSite: { name: "Acme Website", client: "Acme Co", clientId: "c-acme" },
  acmeSocial: { name: "Acme Social", client: "Acme Co", clientId: "c-acme" },
  bright: { name: "Bright Social", client: "Bright Dental", clientId: "c-bright" },
  // The real Ironbrij project is flagged billable and has a client of its
  // own, so only the entry's service category marks its work as internal.
  ironbrij: { name: "Ironbrij", client: "Louis Swart", clientId: "c-louis" },
  admin: { name: "Team admin", client: "Internal — no client", clientId: null },
};
const projectById = (id: string | null) => (id ? projects[id] : undefined);

const HOUR = 3600;
const entry = (over: Partial<Entry> = {}): Entry => ({
  projectId: "acmeSite",
  task: "Design",
  description: "Homepage design",
  seconds: HOUR,
  running: false,
  serviceCategory: null,
  ...over,
});

describe("buildWorkBreakdown", () => {
  it("splits the hours into Ironbrij first, then clients from most hours to least", () => {
    const { totalSeconds, groups } = buildWorkBreakdown(
      [
        entry({ projectId: "bright", seconds: 2 * HOUR }),
        entry({ projectId: "acmeSite", seconds: 5 * HOUR }),
        entry({ projectId: "admin", description: "Team meeting", seconds: HOUR }),
      ],
      projectById,
    );
    expect(totalSeconds).toBe(8 * HOUR);
    expect(groups.map((g) => [g.label, g.seconds / HOUR, g.share])).toEqual([
      ["Ironbrij (internal)", 1, 0.125],
      ["Acme Co", 5, 0.625],
      ["Bright Dental", 2, 0.25],
    ]);
    expect(groups.map((g) => g.internal)).toEqual([true, false, false]);
  });

  it("counts Ironbrij service-line work as internal even though its project has a client", () => {
    const { groups } = buildWorkBreakdown(
      [entry({ projectId: "ironbrij", serviceCategory: "ironbrij", description: "Payroll" })],
      projectById,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: "Ironbrij (internal)", internal: true });
  });

  it("counts work with no project as internal", () => {
    const { groups } = buildWorkBreakdown([entry({ projectId: null })], projectById);
    expect(groups[0]).toMatchObject({ label: "Ironbrij (internal)", internal: true });
  });

  it("puts every project of the same client under one heading", () => {
    const { groups } = buildWorkBreakdown(
      [entry({ projectId: "acmeSite" }), entry({ projectId: "acmeSocial", description: "Posts" })],
      projectById,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: "Acme Co", seconds: 2 * HOUR });
  });

  it("adds up a task done in several stretches, matching it regardless of case and spacing", () => {
    const { groups } = buildWorkBreakdown(
      [
        entry({ description: "Homepage design", seconds: 2 * HOUR }),
        entry({ description: "Client call", seconds: HOUR }),
        entry({ description: "  homepage design ", seconds: 3 * HOUR }),
      ],
      projectById,
    );
    expect(groups[0].tasks).toEqual([
      { label: "Homepage design", seconds: 5 * HOUR },
      { label: "Client call", seconds: HOUR },
    ]);
  });

  it("names a task with no description by its task category, then its project", () => {
    const { groups } = buildWorkBreakdown(
      [
        entry({ description: " ", task: "Copywriting", seconds: 2 * HOUR }),
        entry({ description: "", task: "", seconds: HOUR }),
      ],
      projectById,
    );
    expect(groups[0].tasks.map((t) => t.label)).toEqual(["Copywriting", "Acme Website"]);
  });

  it("leaves out a timer that's still running", () => {
    const { totalSeconds, groups } = buildWorkBreakdown(
      [entry({ seconds: HOUR }), entry({ running: true, seconds: 4 * HOUR, projectId: "bright" })],
      projectById,
    );
    expect(totalSeconds).toBe(HOUR);
    expect(groups.map((g) => g.label)).toEqual(["Acme Co"]);
  });

  it("orders clients with the same hours by name, so the list doesn't jump around", () => {
    const { groups } = buildWorkBreakdown(
      [entry({ projectId: "bright" }), entry({ projectId: "acmeSite" })],
      projectById,
    );
    expect(groups.map((g) => g.label)).toEqual(["Acme Co", "Bright Dental"]);
  });

  it("is empty when nothing finished was logged", () => {
    expect(buildWorkBreakdown([], projectById)).toEqual({ totalSeconds: 0, groups: [] });
  });
});
