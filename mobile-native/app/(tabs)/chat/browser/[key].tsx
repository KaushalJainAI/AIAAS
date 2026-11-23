import { useLocalSearchParams } from 'expo-router';

import { BrowserScreen } from '../../../../src/features/chat/BrowserScreen';

/** The browser calls of one answer: `/chat/browser/<key>`. The key is an in-memory handle, not the data. */
export default function BrowserRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  return <BrowserScreen viewsKey={String(key ?? '')} />;
}
