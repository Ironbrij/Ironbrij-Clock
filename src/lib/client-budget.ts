/** Share of a client's (or project's) hours used before it gets a "Low hours" warning. */
export const BUDGET_WARNING_THRESHOLD = 0.9;

export type ClientBudgetFigures = {
  subscriptionHours: number;
  /** Hours logged in IronTrack on the client's projects. */
  trackedHours: number;
  /** Finished weeks of the client's Casual VA – External placements (client_placement_hours()). */
  placementHours: number;
  /** trackedHours + placementHours. */
  renderedHours: number;
  remainingHours: number;
  /** Every subscription hour has already been used (or exceeded). */
  isOver: boolean;
  /** Not over yet, but within BUDGET_WARNING_THRESHOLD of the cap — a heads-up before it actually runs out. */
  isNearLimit: boolean;
};

/**
 * A client's hours balance. Placed VAs don't log time, so their weeks are
 * added to what was tracked before coming off the subscription, as the
 * Casual Service | Monitoring sheet counts them.
 */
export function clientBudgetStatus(
  subscriptionHours: number,
  trackedHours: number,
  placementHours: number,
): ClientBudgetFigures {
  const renderedHours = trackedHours + placementHours;
  const remainingHours = subscriptionHours - renderedHours;
  return {
    subscriptionHours,
    trackedHours,
    placementHours,
    renderedHours,
    remainingHours,
    isOver: remainingHours <= 0,
    isNearLimit:
      remainingHours > 0 && renderedHours >= subscriptionHours * BUDGET_WARNING_THRESHOLD,
  };
}
