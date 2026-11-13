import { useState } from 'react';

import { Screen } from '../../components/Screen';
import { SegmentedControl } from '../../components/SegmentedControl';
import { BasesTab } from './BasesTab';
import { ExtractionTab } from './ExtractionTab';
import { useExtractionSchemas } from './queries';

type Part = 'bases' | 'extraction';

/** Knowledge: the bases the assistant searches, and the extraction schemas that fill tables from documents. */
export function KnowledgeScreen() {
  const [part, setPart] = useState<Part>('bases');
  const schemas = useExtractionSchemas();
  const waiting = (schemas.data?.items ?? []).reduce((n, s) => n + s.review_count, 0);

  return (
    <Screen edges={['left', 'right']}>
      <SegmentedControl<Part>
        items={[
          { key: 'bases', label: 'Knowledge bases', count: 0 },
          { key: 'extraction', label: 'Extraction', count: waiting },
        ]}
        value={part}
        onChange={setPart}
      />
      {part === 'bases' ? <BasesTab /> : <ExtractionTab />}
    </Screen>
  );
}
