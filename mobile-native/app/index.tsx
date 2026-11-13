import { Redirect } from 'expo-router';

import { useAuth } from '../src/auth/AuthContext';

/** Signed-out users are sent to /login by the gate in _layout.tsx. */
export default function Index() {
  const { status } = useAuth();
  return status === 'signedIn' ? <Redirect href="/(tabs)/chat" /> : null;
}
