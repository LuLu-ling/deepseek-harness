/** Derived observable sources for the row actions' injected hooks. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Project one observable into another, recomputing only when the source
 * snapshot changes identity, so consumers that select from the projection
 * (a Set lookup per row) never rebuild it per read.
 * @param source - the observable to project.
 * @param project - pure projection of one source snapshot.
 * @returns the projected observable, subscribing through the source.
 */
export function derive<S, T>(source: HostObservable<S>, project: (snapshot: S) => T): HostObservable<T> {
  let seen: S | undefined
  let value: T | undefined
  return {
    getSnapshot: () => {
      const snapshot = source.getSnapshot()
      if (value === undefined || snapshot !== seen) {
        seen = snapshot
        value = project(snapshot)
      }
      return value
    },
    subscribe: listener => source.subscribe(listener),
  }
}

/**
 * Project two observables into one. Recomputes when either snapshot changes identity.
 * @param left - the first observable.
 * @param right - the second observable.
 * @param project - pure projection of the two snapshots.
 * @returns the projected observable.
 */
export function derive2<A, B, T>(
  left: HostObservable<A>,
  right: HostObservable<B>,
  project: (left: A, right: B) => T,
): HostObservable<T> {
  let seenLeft: A | undefined
  let seenRight: B | undefined
  let value: T | undefined
  return {
    getSnapshot: () => {
      const nextLeft = left.getSnapshot()
      const nextRight = right.getSnapshot()
      if (value === undefined || nextLeft !== seenLeft || nextRight !== seenRight) {
        seenLeft = nextLeft
        seenRight = nextRight
        value = project(nextLeft, nextRight)
      }
      return value
    },
    subscribe: (listener) => {
      const stopLeft = left.subscribe(listener)
      const stopRight = right.subscribe(listener)
      return () => {
        stopLeft()
        stopRight()
      }
    },
  }
}
