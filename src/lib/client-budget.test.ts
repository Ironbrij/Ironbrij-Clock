import { describe, expect, it } from "vitest";
import { clientBudgetStatus } from "./client-budget";

describe("clientBudgetStatus", () => {
  it("adds placement hours to tracked hours before taking them off the subscription", () => {
    expect(clientBudgetStatus(40, 30, 6)).toEqual({
      subscriptionHours: 40,
      trackedHours: 30,
      placementHours: 6,
      renderedHours: 36,
      remainingHours: 4,
      isOver: false,
      isNearLimit: true,
    });
  });

  it("is over once placement hours use up what tracking left", () => {
    const status = clientBudgetStatus(40, 30, 10);
    expect(status.remainingHours).toBe(0);
    expect(status.isOver).toBe(true);
    expect(status.isNearLimit).toBe(false);
  });

  it("isn't near the limit with most of the hours left", () => {
    expect(clientBudgetStatus(40, 10, 0).isNearLimit).toBe(false);
  });
});
