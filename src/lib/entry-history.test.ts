import { describe, expect, it } from "vitest";
import {
  filterHistoryEntries,
  groupEntriesByDay,
  historyCsvRows,
  historyFloorKey,
  historyRangeForPreset,
} from "./entry-history";

type Entry = Parameters<typeof filterHistoryEntries>[0][number];
type Project = NonNullable<ReturnType<Parameters<typeof filterHistoryEntries>[2]>>;

const TODAY = new Date(2026, 9, 20); // a Tuesday

const projects: Record<string, Project> = {
  acme: { name: "Acme Website", client: "Acme Co", clientId: "c-acme" },
  bright: { name: "Bright Social", client: "Bright Dental", clientId: "c-bright" },
  internal: { name: "Ironbrij Admin", client: "Internal — no client", clientId: null },
};
const projectById = (id: string | null) => (id ? projects[id] : undefined);

let nextId = 0;
const entry = (over: Partial<Entry> = {}): Entry => ({
  id: `e${++nextId}`,
  date: "2026-10-20",
  startTime: "2026-10-20T09:00:00",
  endTime: "2026-10-20T10:30:00",
  seconds: 5400,
  running: false,
  billable: true,
  projectId: "acme",
  task: "Design",
  description: "Homepage design",
  ...over,
});

const noFilters = {
  from: "2026-01-01",
  to: "2026-12-31",
  search: "",
  projectId: null,
  clientId: null,
};

describe("historyFloorKey", () => {
  it("is the first day the app still loads entries for (400 days back)", () => {
    expect(historyFloorKey(TODAY)).toBe("2025-09-15");
  });
});

describe("historyRangeForPreset", () => {
  it.each([
    ["this-week", "2026-10-19", "2026-10-25"],
    ["last-week", "2026-10-12", "2026-10-18"],
    ["this-month", "2026-10-01", "2026-10-31"],
    ["last-month", "2026-09-01", "2026-09-30"],
    ["last-30", "2026-09-21", "2026-10-20"],
    ["last-90", "2026-07-23", "2026-10-20"],
    ["all", "2025-09-15", "2026-10-20"],
  ] as const)("%s runs from %s to %s", (preset, from, to) => {
    expect(historyRangeForPreset(preset, TODAY)).toEqual({ from, to });
  });
});

describe("filterHistoryEntries", () => {
  it("keeps entries inside the date range, both ends included", () => {
    const kept = filterHistoryEntries(
      [
        entry({ date: "2026-10-01", description: "first day" }),
        entry({ date: "2026-10-15", description: "middle" }),
        entry({ date: "2026-10-20", description: "last day" }),
        entry({ date: "2026-09-30", description: "before" }),
        entry({ date: "2026-10-21", description: "after" }),
      ],
      { ...noFilters, from: "2026-10-01", to: "2026-10-20" },
      projectById,
    );
    expect(kept.map((e) => e.description)).toEqual(["first day", "middle", "last day"]);
  });

  it("searches description, task, project and client, ignoring case", () => {
    const entries = [
      entry({ description: "Homepage design", task: "Design", projectId: "acme" }),
      entry({ description: "Reels", task: "Video editing", projectId: "bright" }),
      entry({ description: "Payroll", task: "Admin", projectId: "internal" }),
    ];
    const search = (q: string) =>
      filterHistoryEntries(entries, { ...noFilters, search: q }, projectById).map(
        (e) => e.description,
      );
    expect(search("HOMEPAGE")).toEqual(["Homepage design"]);
    expect(search("video")).toEqual(["Reels"]);
    expect(search("ironbrij")).toEqual(["Payroll"]);
    expect(search("bright dental")).toEqual(["Reels"]);
  });

  it("needs every word of the search to match, in any field", () => {
    const entries = [
      entry({ description: "Homepage design", projectId: "acme" }),
      entry({ description: "Homepage design", projectId: "bright" }),
    ];
    const kept = filterHistoryEntries(
      entries,
      { ...noFilters, search: "homepage dental" },
      projectById,
    );
    expect(kept.map((e) => e.projectId)).toEqual(["bright"]);
  });

  it("doesn't match the 'no client' placeholder name of internal projects", () => {
    const kept = filterHistoryEntries(
      [entry({ projectId: "internal", description: "Payroll" })],
      { ...noFilters, search: "no client" },
      projectById,
    );
    expect(kept).toEqual([]);
  });

  it("filters by project and by client", () => {
    const entries = [
      entry({ projectId: "acme", description: "a" }),
      entry({ projectId: "bright", description: "b" }),
      entry({ projectId: "internal", description: "c" }),
    ];
    expect(
      filterHistoryEntries(entries, { ...noFilters, projectId: "bright" }, projectById).map(
        (e) => e.description,
      ),
    ).toEqual(["b"]);
    expect(
      filterHistoryEntries(entries, { ...noFilters, clientId: "c-acme" }, projectById).map(
        (e) => e.description,
      ),
    ).toEqual(["a"]);
  });
});

describe("groupEntriesByDay", () => {
  it("puts the newest day first, each day's entries in the order they happened, with a total", () => {
    const days = groupEntriesByDay([
      entry({
        date: "2026-10-19",
        startTime: "2026-10-19T14:00:00",
        seconds: 600,
        description: "c",
      }),
      entry({
        date: "2026-10-20",
        startTime: "2026-10-20T09:00:00",
        seconds: 1800,
        description: "a",
      }),
      entry({
        date: "2026-10-19",
        startTime: "2026-10-19T08:00:00",
        seconds: 900,
        description: "b",
      }),
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-10-20", "2026-10-19"]);
    expect(days[1].entries.map((e) => e.description)).toEqual(["b", "c"]);
    expect(days.map((d) => d.seconds)).toEqual([1800, 1500]);
  });
});

describe("historyCsvRows", () => {
  it("writes a header and one row per entry, oldest first", () => {
    const rows = historyCsvRows(
      [
        entry({ date: "2026-10-20", description: "later" }),
        entry({
          date: "2026-10-19",
          startTime: "2026-10-19T09:00:00",
          endTime: "2026-10-19T10:30:00",
          seconds: 5400,
          projectId: "acme",
          task: "Design",
          description: "Homepage design",
          billable: true,
        }),
      ],
      projectById,
    );
    expect(rows[0]).toEqual([
      "Date",
      "Start",
      "End",
      "Hours",
      "Project",
      "Client",
      "Task",
      "Description",
      "Billable",
    ]);
    expect(rows[1]).toEqual([
      "2026-10-19",
      "09:00",
      "10:30",
      "1.50",
      "Acme Website",
      "Acme Co",
      "Design",
      "Homepage design",
      "Yes",
    ]);
    expect(rows[2][7]).toBe("later");
  });

  it("leaves the client blank for internal work and the end blank for a running timer", () => {
    const [, row] = historyCsvRows(
      [entry({ projectId: "internal", running: true, endTime: null, billable: false })],
      projectById,
    );
    expect(row[2]).toBe("");
    expect(row[5]).toBe("");
    expect(row[8]).toBe("No");
  });
});
