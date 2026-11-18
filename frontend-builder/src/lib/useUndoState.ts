import { useReducer } from 'react'

type History<T> = { past: T[]; present: T; future: T[] }
type Action<T> = { type: 'set' | 'reset'; value: T } | { type: 'undo' | 'redo' }
function reduceHistory<T>(state: History<T>, action: Action<T>): History<T> {
  switch (action.type) {
    case 'set':
      return Object.is(state.present, action.value) ? state : { past: [...state.past.slice(-19), state.present], present: action.value, future: [] }
    case 'reset':
      return { past: [], present: action.value, future: [] }
    case 'undo':
      return state.past.length ? { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] } : state
    case 'redo':
      return state.future.length ? { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) } : state
  }
}
/** Bounded, in-memory UI history. No browser storage or financial persistence. */
export function useUndoState<T>(initial: T) {
  const [history, dispatch] = useReducer(reduceHistory<T>, { past: [], present: initial, future: [] })
  return {
    value: history.present,
    set: (value: T) => dispatch({ type: 'set', value }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    reset: (value: T) => dispatch({ type: 'reset', value }),
    canUndo: history.past.length > 0, canRedo: history.future.length > 0,
  }
}
