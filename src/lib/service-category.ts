import type { CasualServiceCategory } from "@/lib/workspace/types";

type CategoryTag = { id: string; serviceCategory: CasualServiceCategory | null };

/**
 * The picked tags that carry a casual service category. A project may have
 * at most one (20261016000000_category_follows_project_tag.sql enforces it),
 * so more than one here is a conflict for the caller to report.
 */
export function categoryTagsAmong<T extends CategoryTag>(
  tagIds: readonly string[],
  tags: readonly T[],
): T[] {
  return tags.filter((t) => t.serviceCategory !== null && tagIds.includes(t.id));
}

/**
 * The category a project's tags give its entries — the same answer as the
 * database's project_service_category(). Null for ordinary client work.
 */
export function serviceCategoryForTags(
  tagIds: readonly string[],
  tags: readonly CategoryTag[],
): CasualServiceCategory | null {
  return categoryTagsAmong(tagIds, tags)[0]?.serviceCategory ?? null;
}
