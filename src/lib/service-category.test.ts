import { describe, expect, it } from "vitest";
import { categoryTagsAmong, serviceCategoryForTags } from "./service-category";

const tags = [
  { id: "pc", serviceCategory: "paid_casual" as const },
  { id: "vip", serviceCategory: "vip_client" as const },
  { id: "client-a", serviceCategory: null },
];

describe("categoryTagsAmong", () => {
  it("returns only the picked tags that carry a category", () => {
    expect(categoryTagsAmong(["client-a", "pc"], tags).map((t) => t.id)).toEqual(["pc"]);
  });

  it("returns every category tag picked, so a caller can spot a conflict", () => {
    expect(categoryTagsAmong(["pc", "vip"], tags).map((t) => t.id)).toEqual(["pc", "vip"]);
  });

  it("ignores ids that aren't known tags", () => {
    expect(categoryTagsAmong(["deleted-tag"], tags)).toEqual([]);
  });
});

describe("serviceCategoryForTags", () => {
  it("is the category of the project's category tag", () => {
    expect(serviceCategoryForTags(["client-a", "vip"], tags)).toBe("vip_client");
  });

  it("is null for a project with no category tag", () => {
    expect(serviceCategoryForTags(["client-a"], tags)).toBeNull();
    expect(serviceCategoryForTags([], tags)).toBeNull();
  });
});
