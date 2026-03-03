export type CrosshairSyncEvent = {
  sourceId: string;
  time: number | null;
};

type Listener = (event: CrosshairSyncEvent) => void;

export class SyncBus {
  private listeners = new Set<Listener>();

  emit(time: number | null, sourceId: string): void {
    const event: CrosshairSyncEvent = { time, sourceId };
    this.listeners.forEach((listener) => {
      listener(event);
    });
  }

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: Listener): void {
    this.listeners.delete(listener);
  }
}

export const chartSyncBus = new SyncBus();
