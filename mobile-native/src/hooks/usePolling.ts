import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * True while this screen is focused and the app is in the foreground. Calls
 * `onFocus` each time the screen gains focus (e.g. to refetch what is shown).
 */
export function useIsLive(onFocus?: () => void): boolean {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');

  // Read the latest callback without re-subscribing the focus effect.
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    onFocusRef.current = onFocus;
  });

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      onFocusRef.current?.();
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  return focused && active;
}

/**
 * A react-query `refetchInterval` that only ticks while the screen is focused
 * and the app is open. Pass the result straight to `useQuery`.
 *
 * @example
 *   const interval = usePolling(30_000);
 *   useQuery({ queryKey, queryFn, refetchInterval: interval });
 */
export function usePolling(intervalMs: number, onFocus?: () => void): number | false {
  const live = useIsLive(onFocus);
  return live ? intervalMs : false;
}
