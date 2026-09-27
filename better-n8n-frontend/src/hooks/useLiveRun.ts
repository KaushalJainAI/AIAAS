/**
 * Keep an open run's detail current while it is going.
 *
 * Runs polled every 5-10s, so a step landed on screen seconds after it
 * happened and a run looked stuck between refreshes. The runtime already
 * streams every step to `ws/execution/{id}/` (`agents/agent/stream.py`); this
 * listens there and refetches the run's detail when anything arrives.
 *
 * Refetching rather than folding frames into the trace is deliberate: the
 * detail endpoint is the one place a run is assembled (turns, steps, cost,
 * delegation), and a second assembly from socket frames is a second renderer
 * of the same run to drift from the first. Frames are coalesced so a burst of
 * steps costs one request.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from '../lib/websocket';

const COALESCE_MS = 400;

export function useLiveRun(executionId: string | null, live: boolean) {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { isConnected } = useSocket({
    path: executionId && live ? `/execution/${executionId}/` : null,
    enabled: !!executionId && live,
    onMessage: () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        queryClient.invalidateQueries({ queryKey: ['run', executionId] });
        queryClient.invalidateQueries({ queryKey: ['runs'] });
      }, COALESCE_MS);
    },
  });

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { isConnected };
}
