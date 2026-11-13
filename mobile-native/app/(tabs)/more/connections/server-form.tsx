import { useLocalSearchParams } from 'expo-router';

import { ServerFormScreen } from '../../../../src/features/connections/ServerFormScreen';
import { idParam } from '../../../../src/features/settings/params';

/** No `id` adds a custom server; with `id` the existing one is edited. */
export default function ServerFormRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  return <ServerFormScreen id={idParam(params.id)} />;
}
