/**
 * Live plan-panel state for one streamed turn (or one run being watched).
 *
 * Beside `useChatStream`, not inside it: the turn's own state (content,
 * todos, files) and the team's state (lanes, locks, changes) change at
 * different rates and are read by different components. Feeding both from one
 * reducer would re-render the transcript on every worker heartbeat.
 */
import { useCallback, useMemo, useReducer } from 'react';
import {
  EMPTY_PLAN,
  planFromOutput,
  reducePlanEvent,
  type PlanStreamEvent,
  type PlanStreamState,
} from '../lib/planStream';

type Action =
  | { type: 'event'; event: PlanStreamEvent }
  | { type: 'seed'; output: unknown }
  | { type: 'reset' };

function reducer(state: PlanStreamState, action: Action): PlanStreamState {
  switch (action.type) {
    case 'event':
      return reducePlanEvent(state, action.event);
    case 'seed':
      return planFromOutput(action.output);
    case 'reset':
      return EMPTY_PLAN;
  }
}

export function usePlanStream() {
  const [plan, dispatch] = useReducer(reducer, EMPTY_PLAN);

  const applyPlanEvent = useCallback((event: PlanStreamEvent) => {
    dispatch({ type: 'event', event });
  }, []);

  const seedPlan = useCallback((output: unknown) => {
    dispatch({ type: 'seed', output });
  }, []);

  const resetPlan = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);

  return useMemo(
    () => ({ plan, applyPlanEvent, seedPlan, resetPlan }),
    [plan, applyPlanEvent, seedPlan, resetPlan],
  );
}
