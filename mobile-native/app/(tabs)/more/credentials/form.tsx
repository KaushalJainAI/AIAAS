import { useLocalSearchParams } from 'expo-router';

import { CredentialFormScreen } from '../../../../src/features/credentials/CredentialFormScreen';
import { idParam, param } from '../../../../src/features/settings/params';

/**
 * `?id=` edits a saved credential. `?type=<slug>` starts a new one of that type.
 * With neither, the type picker comes first.
 */
export default function CredentialFormRoute() {
  const params = useLocalSearchParams<{ id?: string | string[]; type?: string | string[] }>();
  return <CredentialFormScreen id={idParam(params.id)} typeSlug={param(params.type) ?? null} />;
}
