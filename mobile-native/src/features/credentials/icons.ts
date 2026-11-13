import type { IconName } from '../../components/Icon';

/**
 * The web keys a credential type's icon by the string the backend stores, so a
 * new type is a fixture row, not a code change. Same keys here, Ionicons names.
 */
const ICONS: Record<string, IconName> = {
  Mail: 'mail-outline',
  Database: 'server-outline',
  MessageSquare: 'chatbubble-outline',
  Cloud: 'cloud-outline',
  Key: 'key-outline',
  Globe: 'globe-outline',
  Shield: 'shield-checkmark-outline',
  Brain: 'bulb-outline',
  Search: 'search-outline',
};

export function credentialIcon(name: string | undefined): IconName {
  return (name && ICONS[name]) || 'key-outline';
}
