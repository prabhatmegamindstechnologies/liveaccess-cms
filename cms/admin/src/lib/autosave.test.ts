import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, ConflictError } from "./autosave.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(save = vi.fn(async () => {})) {
  const states: string[] = [];
  const saver = createAutosaver({ save, delay: 2000, maxWait: 10000, onState: (s) => states.push(s.status) });
  return { saver, save, states };
}

describe("createAutosaver", () => {
  it("saves 2 seconds after the last change", async () => {
    const { saver, save } = setup();
    saver.touch();
    await vi.advanceTimersByTimeAsync(1900);
    saver.touch();
    await vi.advanceTimersByTimeAsync(1900);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves at least every 10 seconds while someone keeps typing", async () => {
    const { saver, save } = setup();
    for (let t = 0; t < 10500; t += 500) {
      saver.touch();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("never runs two saves at once and saves again if changes came in meanwhile", async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    const { saver } = setup(save);
    saver.touch();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    saver.touch();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("stops saving after a conflict", async () => {
    const save = vi.fn(async () => { throw new ConflictError("Changed by Akash"); });
    const { saver, states } = setup(save);
    saver.touch();
    await vi.advanceTimersByTimeAsync(2000);
    saver.touch();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("conflict");
    expect(saver.state().message).toBe("Changed by Akash");
  });

  it("retries after a network error", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const { saver, states } = setup(save);
    saver.touch();
    await vi.advanceTimersByTimeAsync(2000);
    expect(states.at(-1)).toBe("error");
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe("saved");
  });

  it("flushes right away when asked (tab hidden, leaving the page)", async () => {
    const { saver, save } = setup();
    saver.touch();
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.state().pending).toBe(false);
  });
});
