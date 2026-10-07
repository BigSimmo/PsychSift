import { UNDO_MS } from "@/components/teaching/use-delayed-post";

/*
 * The clock behind the inbox's pretend sends. Each send waits 10 seconds, with Undo, before it counts as sent.
 *
 * The clock is the provider's own, not the Undo message's. The shared message stack holds five messages and
 * pushes the oldest off when a sixth arrives, and a message pushed off cannot be told apart from one whose time
 * ran out. So the message is only a way to reach Undo:
 * - a send is registered here before its message is shown, so nothing that happens while showing it can lose it;
 * - a message pushed off the stack leaves its send running here, and it still goes when its own 10 seconds end
 *   (Undo stays on the inbox's "Sending" line meanwhile);
 * - while the doctor touches or focuses any message, every send waits, so one held past 10 seconds and then
 *   pushed off does not go at once;
 * - each send finishes exactly once: when its time is up, when its message is dismissed, or never, if it is
 *   undone or the page closes first.
 */

type Timer = ReturnType<typeof setTimeout>;

export interface PendingSend {
  readonly key: number;
  /** The answers in this send. */
  readonly ids: readonly string[];
  /** The Undo message showing for it, or null once it was pushed off the stack. */
  toastId: string | null;
  remaining: number;
  startedAt: number | null;
  timer: Timer | null;
}

export class PendingSends {
  private readonly sends = new Map<number, PendingSend>();
  private nextKey = 1;
  private held = false;

  /** Called once when a send's time is up (or it is finished by hand), after it has left the clock. */
  onDue: (send: PendingSend) => void = () => {};

  constructor(private readonly ms: number = UNDO_MS) {}

  /** True while this answer is in a send that has not finished. */
  has(id: string): boolean {
    for (const send of this.sends.values()) if (send.ids.includes(id)) return true;
    return false;
  }

  get(key: number): PendingSend | undefined {
    return this.sends.get(key);
  }

  get size(): number {
    return this.sends.size;
  }

  /** Registers a send and starts its 10 seconds (paused while a message is held). Returns its key. */
  start(ids: readonly string[]): number {
    const key = this.nextKey++;
    const send: PendingSend = { key, ids: [...ids], toastId: null, remaining: this.ms, startedAt: null, timer: null };
    this.sends.set(key, send);
    if (!this.held) this.run(send);
    return key;
  }

  /** Every send waits while the doctor touches or focuses an Undo message, and carries on when they let go. */
  hold(held: boolean): void {
    if (held === this.held) return;
    this.held = held;
    for (const send of this.sends.values()) {
      if (held) this.pause(send);
      else this.run(send);
    }
  }

  /** Takes a send off the clock without finishing it (Undo). Returns it, or undefined if it already finished. */
  cancel(key: number): PendingSend | undefined {
    const send = this.sends.get(key);
    if (!send) return undefined;
    this.stop(send);
    this.sends.delete(key);
    return send;
  }

  /** Takes every send off the clock (Undo all, or the page closing). */
  cancelAll(): PendingSend[] {
    const all = [...this.sends.values()];
    for (const send of all) this.stop(send);
    this.sends.clear();
    return all;
  }

  /** Finishes a send now (its message was dismissed by hand), exactly once. */
  finishNow(key: number): void {
    const send = this.cancel(key);
    if (send) this.onDue(send);
  }

  private run(send: PendingSend): void {
    if (send.timer) return;
    send.startedAt = Date.now();
    send.timer = setTimeout(() => {
      send.timer = null;
      if (this.sends.get(send.key) !== send) return;
      this.sends.delete(send.key);
      this.onDue(send);
    }, send.remaining);
  }

  private pause(send: PendingSend): void {
    if (!send.timer || send.startedAt === null) return;
    clearTimeout(send.timer);
    send.timer = null;
    send.remaining = Math.max(0, send.remaining - (Date.now() - send.startedAt));
    send.startedAt = null;
  }

  private stop(send: PendingSend): void {
    if (send.timer) clearTimeout(send.timer);
    send.timer = null;
  }
}

/** The Undo message element an event happened in, if any (the shared stack marks each with this test id). */
export function inUndoMessage(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-testid="toast"]') !== null;
}
