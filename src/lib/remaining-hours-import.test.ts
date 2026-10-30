import { describe, expect, it } from "vitest";
import {
  buildPreviewRows,
  matchClientNames,
  newSubscriptionHours,
  normaliseClientName,
  parseHoursCell,
  parseRemainingHoursPaste,
} from "./remaining-hours-import";

describe("parseHoursCell", () => {
  it.each([
    ["23.75", 23.75],
    ["1,225.24", 1225.24],
    ["-23.62", -23.62],
    ["−23.62", -23.62],
    ["(23.62)", -23.62],
    [" 8.99 ", 8.99],
    ["0", 0],
  ])("reads %j as %d", (cell, hours) => {
    expect(parseHoursCell(cell)).toBe(hours);
  });

  it.each(["Remaining Hours", "", "  ", "12abc", "#REF!"])("can't read %j", (cell) => {
    expect(parseHoursCell(cell)).toBeNull();
  });
});

describe("parseRemainingHoursPaste", () => {
  it("reads tab-separated lines from Google Sheets and lists the header as unread", () => {
    expect(
      parseRemainingHoursPaste(
        "Client\tRemaining Hours\r\nArnab Nandi\t23.75\r\n\r\nKim Wasley\t-23.62\n",
      ),
    ).toEqual({
      rows: [
        { line: 2, name: "Arnab Nandi", hours: 23.75 },
        { line: 4, name: "Kim Wasley", hours: -23.62 },
      ],
      unread: [{ line: 1, text: "Client\tRemaining Hours" }],
    });
  });

  it("takes the last cell as the hours when more columns are copied", () => {
    expect(parseRemainingHoursPaste("Jo Jackson\t320\t311.25\t8.75").rows).toEqual([
      { line: 1, name: "Jo Jackson", hours: 8.75 },
    ]);
  });

  it("ignores an empty cell at the end of a line", () => {
    expect(parseRemainingHoursPaste("Jo Jackson\t8.75\t").rows).toEqual([
      { line: 1, name: "Jo Jackson", hours: 8.75 },
    ]);
  });

  it("splits a line with no tab at its last space", () => {
    expect(parseRemainingHoursPaste("Arnab Nandi 23.75").rows).toEqual([
      { line: 1, name: "Arnab Nandi", hours: 23.75 },
    ]);
  });

  it("lists a line with a name but no number as unread", () => {
    expect(parseRemainingHoursPaste("Total\t\nNoy Shani").unread).toEqual([
      { line: 1, text: "Total" },
      { line: 2, text: "Noy Shani" },
    ]);
  });
});

describe("normaliseClientName", () => {
  it("ignores case and extra spaces", () => {
    expect(normaliseClientName("  Tammy  L   Schwinegruber ")).toBe(
      normaliseClientName("tammy l schwinegruber"),
    );
  });

  it("ignores accents", () => {
    expect(normaliseClientName("Zoë")).toBe(normaliseClientName("Zoe"));
  });
});

describe("matchClientNames", () => {
  const clients = [
    { id: "c1", name: "Arnab Nandi" },
    { id: "c2", name: "Jango Management Pty Ltd" },
  ];

  it("matches names after normalising, and never guesses", () => {
    const matches = matchClientNames(
      [
        { line: 1, name: "arnab  nandi", hours: 23.75 },
        { line: 2, name: "Jango Management", hours: 23.5 },
      ],
      clients,
    );
    expect(matches.get(1)).toBe("c1");
    expect(matches.get(2)).toBeNull();
  });
});

describe("newSubscriptionHours", () => {
  it("sets the subscription so the remaining hours land on the sheet's figure", () => {
    expect(newSubscriptionHours(23.75, 776.2333)).toBe(799.98);
  });

  it("handles a client already over", () => {
    expect(newSubscriptionHours(-23.62, 1248.86)).toBe(1225.24);
  });
});

describe("buildPreviewRows", () => {
  const figures = new Map([
    ["c1", { subscriptionHours: 800, renderedHours: 776.25 }],
    ["c2", { subscriptionHours: null, renderedHours: 30 }],
    ["c3", { subscriptionHours: 40, renderedHours: 31.25 }],
  ]);

  it("works out each row's current, difference and new subscription", () => {
    const [row] = buildPreviewRows(
      [{ line: 1, name: "Arnab Nandi", hours: 20 }],
      new Map([[1, "c1"]]),
      figures,
    );
    expect(row).toEqual({
      line: 1,
      sheetName: "Arnab Nandi",
      sheetHours: 20,
      clientId: "c1",
      currentRemaining: 23.75,
      difference: -3.75,
      newSubscription: 796.25,
      status: "ok",
    });
  });

  it("can apply to a client with no allowance yet", () => {
    const [row] = buildPreviewRows(
      [{ line: 1, name: "New", hours: 10 }],
      new Map([[1, "c2"]]),
      figures,
    );
    expect(row.currentRemaining).toBeNull();
    expect(row.difference).toBeNull();
    expect(row.newSubscription).toBe(40);
    expect(row.status).toBe("ok");
  });

  it("marks a row that already matches as no change", () => {
    const [row] = buildPreviewRows(
      [{ line: 1, name: "Janelle Anderson", hours: 8.75 }],
      new Map([[1, "c3"]]),
      figures,
    );
    expect(row.status).toBe("no-change");
  });

  it("marks a row with no client as unmatched", () => {
    const [row] = buildPreviewRows(
      [{ line: 1, name: "Nobody", hours: 5 }],
      new Map([[1, null]]),
      figures,
    );
    expect(row).toMatchObject({ clientId: null, newSubscription: null, status: "unmatched" });
  });

  it("marks every row pointing at the same client as a duplicate", () => {
    const rows = buildPreviewRows(
      [
        { line: 1, name: "Arnab Nandi", hours: 20 },
        { line: 2, name: "A. Nandi", hours: 21 },
      ],
      new Map([
        [1, "c1"],
        [2, "c1"],
      ]),
      figures,
    );
    expect(rows.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
  });
});
