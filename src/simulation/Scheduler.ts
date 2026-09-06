export interface ScheduledEvent {
  id: string;
  executeAt: number;
  callback: () => void;
}

export class Scheduler {
  private events: ScheduledEvent[] = [];

  schedule(id: string, executeAt: number, callback: () => void): void {
    this.events.push({ id, executeAt, callback });
    this.events.sort((a, b) => a.executeAt - b.executeAt);
  }

  update(time: number): void {
    while (this.events[0]?.executeAt <= time) this.events.shift()?.callback();
  }

  clear(): void {
    this.events = [];
  }
}