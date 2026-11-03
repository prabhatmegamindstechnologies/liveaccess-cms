// Auto-save controller: saves a short time after the last change, at most `maxWait` apart while typing,
// one save at a time, retries on network errors, and stops on a version conflict.

export class ConflictError extends Error {}

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "conflict";
export type SaveState = { status: SaveStatus; pending: boolean; savedAt: Date | null; message: string };

type Options = { save: () => Promise<void>; delay?: number; maxWait?: number; retry?: number; onState?: (s: SaveState) => void };

export function createAutosaver({ save, delay = 2000, maxWait = 10000, retry = 5000, onState }: Options) {
  let st: SaveState = { status: "idle", pending: false, savedAt: null, message: "" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstChange = 0;
  let lastChange = 0;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const set = (patch: Partial<SaveState>) => {
    st = { ...st, ...patch };
    onState?.(st);
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  async function run(): Promise<void> {
    clear();
    if (stopped || !st.pending) return;
    if (inFlight) return; // the running save re-checks `pending` when it finishes
    st.pending = false;
    firstChange = 0;
    set({ status: "saving" });
    inFlight = save()
      .then(() => {
        set({ status: st.pending ? "pending" : "saved", savedAt: new Date(), message: "" });
      })
      .catch((err: unknown) => {
        if (err instanceof ConflictError) {
          stopped = true;
          set({ status: "conflict", message: err.message });
          return;
        }
        st.pending = true;
        set({ status: "error", message: err instanceof Error ? err.message : "Couldn't save." });
        timer = setTimeout(run, retry);
      })
      .finally(() => {
        inFlight = null;
        if (!stopped && st.pending && st.status !== "error") schedule();
      });
    return inFlight;
  }

  function schedule() {
    if (stopped) return;
    clear();
    const now = Date.now();
    if (!firstChange) firstChange = lastChange || now;
    // Count from the last change (it may have happened while a save was running), capped by maxWait.
    const wait = Math.max(0, Math.min((lastChange || now) + delay - now, firstChange + maxWait - now));
    timer = setTimeout(run, wait);
  }

  return {
    /** Call after every change. */
    touch() {
      if (stopped) return;
      lastChange = Date.now();
      if (!firstChange) firstChange = lastChange;
      set({ pending: true, status: inFlight ? st.status : "pending" });
      schedule();
    },
    /** Save now (tab hidden, leaving the editor). Resolves when nothing is left to save. */
    async flush() {
      while (!stopped && (st.pending || inFlight)) {
        if (inFlight) await inFlight;
        else await run();
      }
    },
    state: () => st,
    dispose() {
      stopped = true;
      clear();
    }
  };
}
