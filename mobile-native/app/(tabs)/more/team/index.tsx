import { Screen } from '../../../../src/components/Screen';
import { TeamScreen } from '../../../../src/features/team/TeamScreen';

export default function TeamRoute() {
  return (
    <Screen edges={['left', 'right']}>
      <TeamScreen />
    </Screen>
  );
}
