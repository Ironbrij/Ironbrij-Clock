import { describe, expect, it } from "vitest";
import { splitTime } from "./time-split";

type Entry = Parameters<typeof splitTime>[0][number];
type Project = NonNullable<ReturnType<Parameters<typeof splitTime>[2]>>;

const projects: Record<string, Project> = {
  acme: { name: "Acme Website", client: "Acme Co", clientId: "c-acme", color: "red" },
  acmeSeo: { name: "Acme SEO", client: "Acme Co", clientId: "c-acme", color: "pink" },
  bright: { name: "Bright Social", client: "Bright Dental", clientId: "c-bright", color: "blue" },
  internal: {
    name: "Ironbrij Admin",
    client: "Internal — no client",
    clientId: null,
    color: "grey",
  },
};
const projectById = (id: string | null) => (id ? projects[id] : undefined);

const entry = (projectId: string | null, hours: number, task = "Design"): Entry => ({
  projectId,
  seconds: hours * 3600,
  task,
});

describe("splitTime", () => {
  it("splits hours by project, biggest first, with each project's own colour and share", () => {
    const slices = splitTime(
      [entry("acme", 1), entry("bright", 3), entry("acme", 2), entry("internal", 2)],
      "project",
      projectById,
    );
    expect(slices.map((s) => [s.label, s.seconds / 3600, s.share, s.color])).toEqual([
      ["Acme Website", 3, 0.375, "red"],
      ["Bright Social", 3, 0.375, "blue"],
      ["Ironbrij Admin", 2, 0.25, "grey"],
    ]);
  });

  it("splits by client, putting projects without one under Internal", () => {
    const slices = splitTime(
      [entry("acme", 1), entry("acmeSeo", 2), entry("bright", 1), entry("internal", 4)],
      "client",
      projectById,
    );
    expect(slices.map((s) => [s.label, s.seconds / 3600])).toEqual([
      ["Internal", 4],
      ["Acme Co", 3],
      ["Bright Dental", 1],
    ]);
  });

  it("splits by task category, with uncategorised time kept separate", () => {
    const slices = splitTime(
      [entry("acme", 2, "Design"), entry("bright", 1, "Copywriting"), entry("acme", 1, "")],
      "category",
      projectById,
    );
    expect(slices.map((s) => [s.label, s.seconds / 3600])).toEqual([
      ["Design", 2],
      ["Copywriting", 1],
      ["No category", 1],
    ]);
  });

  it("gives client and category slices no colour of their own, so the chart can apply its palette", () => {
    const slices = splitTime([entry("acme", 1)], "client", projectById);
    expect(slices[0].color).toBeNull();
  });

  it("folds everything past the slice limit into one Other slice at the end", () => {
    const slices = splitTime(
      [
        entry("acme", 5, "A"),
        entry("acme", 4, "B"),
        entry("acme", 3, "C"),
        entry("acme", 2, "D"),
        entry("acme", 1, "E"),
        entry("acme", 1, "F"),
      ],
      "category",
      projectById,
      { maxSlices: 4 },
    );
    expect(slices.map((s) => [s.label, s.seconds / 3600, s.isOther])).toEqual([
      ["A", 5, false],
      ["B", 4, false],
      ["C", 3, false],
      ["Other", 4, true],
    ]);
  });

  it("doesn't make an Other slice when everything fits", () => {
    const slices = splitTime(
      [entry("acme", 1, "A"), entry("acme", 1, "B")],
      "category",
      projectById,
      { maxSlices: 2 },
    );
    expect(slices.some((s) => s.isOther)).toBe(false);
  });

  it("is empty when no time was logged", () => {
    expect(splitTime([], "project", projectById)).toEqual([]);
    expect(splitTime([entry("acme", 0)], "project", projectById)).toEqual([]);
  });
});
