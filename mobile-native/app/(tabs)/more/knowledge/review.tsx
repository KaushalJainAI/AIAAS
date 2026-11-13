import { Screen } from '../../../../src/components/Screen';
import { ReviewQueue } from '../../../../src/features/knowledge/ReviewQueue';

export default function KnowledgeReviewRoute() {
  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ReviewQueue />
    </Screen>
  );
}
