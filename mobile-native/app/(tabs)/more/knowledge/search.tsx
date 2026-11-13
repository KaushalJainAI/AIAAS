import { Screen } from '../../../../src/components/Screen';
import { SearchScreen } from '../../../../src/features/knowledge/SearchScreen';

export default function KnowledgeSearchRoute() {
  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <SearchScreen />
    </Screen>
  );
}
