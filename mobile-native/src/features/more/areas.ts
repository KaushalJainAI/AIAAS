import type { IconName } from '../../components/Icon';

export interface MoreArea {
  label: string;
  icon: IconName;
  /** An expo-router path. Every entry except Settings is a screen under app/(tabs)/more. */
  href: string;
}

export interface MoreGroup {
  title: string;
  items: MoreArea[];
}

/** The single list of every area reached from More. Add an entry here when a screen is built. */
export const MORE_GROUPS: MoreGroup[] = [
  {
    title: 'Work',
    items: [
      { label: 'Runs', icon: 'play-circle-outline', href: '/more/runs' },
      { label: 'Schedules', icon: 'time-outline', href: '/more/schedules' },
      { label: 'Missions', icon: 'flag-outline', href: '/more/missions' },
      { label: 'Dashboards', icon: 'bar-chart-outline', href: '/more/dashboards' },
      { label: 'Pages', icon: 'document-text-outline', href: '/more/pages' },
    ],
  },
  {
    title: 'Build',
    items: [
      { label: 'Explore templates', icon: 'compass-outline', href: '/more/explore' },
      { label: 'Skills', icon: 'sparkles-outline', href: '/more/skills' },
      { label: 'Tools', icon: 'construct-outline', href: '/more/tools' },
      { label: 'Evals', icon: 'flask-outline', href: '/more/evals' },
    ],
  },
  {
    title: 'Knowledge',
    items: [
      { label: 'Knowledge bases', icon: 'library-outline', href: '/more/knowledge' },
      { label: 'Team knowledge', icon: 'people-outline', href: '/more/team' },
    ],
  },
  {
    title: 'Create',
    items: [
      { label: 'Apps', icon: 'apps-outline', href: '/more/apps' },
      { label: 'Imagine', icon: 'image-outline', href: '/more/imagine' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Connections', icon: 'link-outline', href: '/more/connections' },
      { label: 'Credentials', icon: 'key-outline', href: '/more/credentials' },
      { label: 'Settings', icon: 'settings-outline', href: '/settings' },
    ],
  },
];
