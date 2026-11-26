/* A tiny notifier: the stores call notifyDataChanged() after saving, and the sync module listens.
   This keeps the stores unaware of the sync feature (no circular imports). */

const listeners = [];

/** Register a function that runs whenever local to-dos or entries were saved by the user. */
export function onDataChanged(listener) {
  listeners.push(listener);
}

/** Tell every listener that local data changed. */
export function notifyDataChanged() {
  listeners.forEach((listener) => listener());
}
