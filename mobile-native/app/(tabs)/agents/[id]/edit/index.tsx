import { useLocalSearchParams } from 'expo-router';

import { EditIndexScreen } from '../../../../../src/features/builder/screens/EditIndex';

/** The builder's front page. `new` is the create flow. */
export default function EditRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditIndexScreen id={String(id ?? 'new')} />;
}
