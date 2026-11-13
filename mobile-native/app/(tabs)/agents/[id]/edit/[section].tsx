import { useLocalSearchParams } from 'expo-router';

import { EmptyState } from '../../../../../src/components/EmptyState';
import { Screen } from '../../../../../src/components/Screen';
import { sectionInfo } from '../../../../../src/features/builder/sections';
import { SECTION_SCREENS } from '../../../../../src/features/builder/screens';

/** One screen of the builder, picked by its section name. */
export default function SectionRoute() {
  const { id, section } = useLocalSearchParams<{ id: string; section: string }>();
  const info = sectionInfo(String(section ?? ''));
  if (!info) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <EmptyState title="Not found" message="There is no such setting." />
      </Screen>
    );
  }
  const Component = SECTION_SCREENS[info.key];
  return <Component id={String(id ?? 'new')} />;
}
