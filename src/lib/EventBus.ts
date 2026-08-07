type Listener<T> = (data: T) => void;

export class EventBus<T> {
  private listeners: Set<Listener<T>> = new Set();

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(data: T) {
    for (const listener of this.listeners) {
      listener(data);
    }
  }
}
