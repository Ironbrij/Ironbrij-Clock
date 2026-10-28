import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDescriptionAutosave } from "./description-autosave";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Lets settled save promises run their callbacks before the next assertion.
const settlePromises = () => vi.advanceTimersByTimeAsync(0);

describe("createDescriptionAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves once the person pauses, not on every keystroke", async () => {
    const save = vi.fn(async () => {});
    const autosave = createDescriptionAutosave({ save, delayMs: 1000 });
    autosave.reset("e1", "");

    autosave.edit("W");
    autosave.edit("Wr");
    autosave.edit("Writing");
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("e1", "Writing");
  });

  it("saves straight away on flush, without saving again when the pause ends", async () => {
    const save = vi.fn(async () => {});
    const autosave = createDescriptionAutosave({ save, delayMs: 1000 });
    autosave.reset("e1", "");

    autosave.edit("Writing");
    autosave.flush();
    await settlePromises();
    expect(save).toHaveBeenCalledWith("e1", "Writing");

    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves nothing while no timer is running", async () => {
    const save = vi.fn(async () => {});
    const autosave = createDescriptionAutosave({ save, delayMs: 1000 });
    autosave.reset(null, "");

    autosave.edit("Next task");
    autosave.flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });

  it("doesn't save text the entry already has", () => {
    const save = vi.fn(async () => {});
    const autosave = createDescriptionAutosave({ save });
    autosave.reset("e1", "Writing");

    autosave.edit("Writing");
    autosave.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("skips text canSave rejects, such as a blank box when descriptions are required", () => {
    const save = vi.fn(async () => {});
    const autosave = createDescriptionAutosave({ save, canSave: (text) => text.trim() !== "" });
    autosave.reset("e1", "Writing");

    autosave.edit("  ");
    autosave.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the entry comes back from a refresh with the old text", () => {
    const autosave = createDescriptionAutosave({ save: async () => {} });
    autosave.reset("e1", "");

    autosave.edit("Writing the report");
    expect(autosave.entryChanged("")).toBeNull();
  });

  it("ignores the entry echoing back its own save", async () => {
    const autosave = createDescriptionAutosave({ save: async () => {} });
    autosave.reset("e1", "");

    autosave.edit("Writing");
    autosave.flush();
    await settlePromises();
    expect(autosave.entryChanged("Writing")).toBeNull();
  });

  it("ignores the entry changing while a save is still going out", async () => {
    const pending = deferred();
    const autosave = createDescriptionAutosave({ save: () => pending.promise });
    autosave.reset("e1", "Writing");

    autosave.edit("Writing the report");
    autosave.flush();
    expect(autosave.entryChanged("Something older")).toBeNull();

    pending.resolve();
    await settlePromises();
    expect(autosave.entryChanged("Writing the report")).toBeNull();
  });

  it("takes an edit made somewhere else when nothing is being typed", () => {
    const save = vi.fn(async () => {});
    const autosave = createDescriptionAutosave({ save });
    autosave.reset("e1", "Writing");

    expect(autosave.entryChanged("Edited in the dialog")).toBe("Edited in the dialog");

    autosave.edit("Edited in the dialog");
    autosave.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("sends saves one at a time, in the order they were typed", async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const autosave = createDescriptionAutosave({ save });
    autosave.reset("e1", "");

    autosave.edit("Writing");
    autosave.flush();
    autosave.edit("Writing the report");
    autosave.flush();
    await settlePromises();
    expect(save).toHaveBeenCalledTimes(1);

    first.resolve();
    await settlePromises();
    expect(save.mock.calls).toEqual([
      ["e1", "Writing"],
      ["e1", "Writing the report"],
    ]);
  });

  it("saves against the entry the text was typed for, even after the next timer starts", async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const autosave = createDescriptionAutosave({ save });
    autosave.reset("e1", "");
    autosave.edit("First task");
    autosave.flush();

    autosave.reset("e2", "");
    autosave.edit("Second task");
    autosave.flush();
    first.resolve();
    await settlePromises();

    expect(save.mock.calls).toEqual([
      ["e1", "First task"],
      ["e2", "Second task"],
    ]);
  });

  it("settle drops a save that hasn't started and waits for one that has", async () => {
    const pending = deferred();
    const save = vi.fn(() => pending.promise);
    const autosave = createDescriptionAutosave({ save, delayMs: 1000 });
    autosave.reset("e1", "");
    autosave.edit("Writing");
    autosave.flush();
    autosave.edit("Writing the report");

    let settled = false;
    void autosave.settle().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    pending.resolve();
    await settlePromises();
    expect(settled).toBe(true);
  });

  it("reports a failed save, keeps the typed text and tries again on the next flush", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const onError = vi.fn();
    const autosave = createDescriptionAutosave({ save, onError });
    autosave.reset("e1", "");

    autosave.edit("Writing");
    autosave.flush();
    await settlePromises();
    expect(onError).toHaveBeenCalledWith(new Error("offline"));
    expect(autosave.entryChanged("Something older")).toBeNull();

    autosave.flush();
    await settlePromises();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("e1", "Writing");
  });
});
