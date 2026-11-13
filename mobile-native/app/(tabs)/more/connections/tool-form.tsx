import { useLocalSearchParams } from 'expo-router';

import { ToolFormScreen } from '../../../../src/features/connections/ToolFormScreen';
import { idParam, param } from '../../../../src/features/settings/params';
import type { CustomToolKind } from '../../../../src/features/connections/types';

/** No params adds a tool; `kind` + `id` edits one of the user's own API or database tools. */
export default function ToolFormRoute() {
  const params = useLocalSearchParams<{ kind?: string | string[]; id?: string | string[] }>();
  const kind = param(params.kind);
  const editKind: CustomToolKind | null = kind === 'api' || kind === 'data' ? kind : null;
  return <ToolFormScreen kind={editKind} id={idParam(params.id)} />;
}
