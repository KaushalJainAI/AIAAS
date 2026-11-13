/**
 * Presentation for a connection, keyed on `MCPServer.icon_slug`. Mirrors
 * better-n8n-frontend/src/lib/connectorIcons.ts, with Ionicons names in place
 * of the web's lucide components.
 *
 * Text (name, tagline, category, help link) comes from the database. Only the
 * icon and its tone live here. The tone is a theme token name, never a colour
 * value, so a connector reads the same in light and dark mode. A slug with no
 * entry falls back, so an unknown connector still renders. Never key
 * presentation off `name`.
 */

import type { IconName } from '../../components/Icon';
import type { MCPServerCategory } from './types';

/** Theme colours a connector icon may use. Each is a key of `useTheme().colors`. */
export type ConnectorTone =
  | 'primary'
  | 'agent'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'text'
  | 'mutedText';

export interface ConnectorVisual {
  icon: IconName;
  tone: ConnectorTone;
}

const VISUALS: Record<string, ConnectorVisual> = {
  'google-drive': { icon: 'cloud-outline', tone: 'info' },
  gmail: { icon: 'mail-outline', tone: 'danger' },
  'google-calendar': { icon: 'calendar-outline', tone: 'success' },
  'google-sheets': { icon: 'grid-outline', tone: 'success' },
  'google-docs': { icon: 'document-text-outline', tone: 'info' },
  notion: { icon: 'book-outline', tone: 'mutedText' },
  slack: { icon: 'logo-slack', tone: 'agent' },
  github: { icon: 'logo-github', tone: 'text' },
  filesystem: { icon: 'folder-outline', tone: 'agent' },
  fetch: { icon: 'globe-outline', tone: 'info' },
  memory: { icon: 'bookmark-outline', tone: 'warning' },
  'sequential-thinking': { icon: 'git-network-outline', tone: 'warning' },
};

/** Shown for a built-in connector whose slug this build has never heard of. */
const FALLBACK: ConnectorVisual = { icon: 'extension-puzzle-outline', tone: 'mutedText' };

/** A user's own MCP server: a command line, not a brand. */
const CUSTOM: ConnectorVisual = { icon: 'terminal-outline', tone: 'mutedText' };

export function connectorVisual(iconSlug: string | undefined, isSystem: boolean): ConnectorVisual {
  if (iconSlug && VISUALS[iconSlug]) return VISUALS[iconSlug];
  return isSystem ? FALLBACK : CUSTOM;
}

/** Category copy. The server stores the key; the words are the web's own. */
export const CATEGORY_LABELS: Record<MCPServerCategory, string> = {
  google_workspace: 'Google Workspace',
  communication: 'Communication',
  productivity: 'Productivity',
  development: 'Development',
  utilities: 'Built in',
  custom: 'Custom',
};

export const CATEGORY_BLURBS: Record<MCPServerCategory, string> = {
  google_workspace: 'Sign in once and the assistant can work with your mail, files, and calendar.',
  communication: 'Let the assistant read and post messages for you.',
  productivity: 'Connect the knowledge and task tools your team already uses.',
  development: 'Give the assistant access to your code and issues.',
  utilities: 'Always available. Nothing to set up.',
  custom: 'Connections you added yourself.',
};

/** Display order. Built-ins are not listed: they are retired duplicates (the web hides them too). */
export const CATEGORY_ORDER: MCPServerCategory[] = [
  'google_workspace',
  'communication',
  'productivity',
  'development',
];
