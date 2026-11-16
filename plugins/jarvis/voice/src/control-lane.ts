/** Serialize ordinary controls; urgent stop supersedes presentation, never waits
 * for synthesis or playout. A stale completion cannot release its successor. */
export class ControlLane {
  private current?: symbol;
  private closed = false;
  get busy() { return this.current !== undefined; }
  async run(operation: (isCurrent: () => boolean) => Promise<void>, {preempt = false} = {}) {
    if (this.closed) throw Error('Conversation closed');
    if (this.busy && !preempt) throw Error('Another command is still running');
    const ticket = Symbol();
    this.current = ticket;
    const isCurrent = () => !this.closed && this.current === ticket;
    try { await operation(isCurrent); }
    catch (error) { if (isCurrent()) throw error; }
    finally { if (this.current === ticket) this.current = undefined; }
  }
  cancel() { this.current = undefined; }
  close() { this.closed = true; this.cancel(); }
}
