/**
 * Presentation for a connection, keyed on `MCPServer.icon_slug`.
 *
 * Everything about a connector that is *text* — its name, tagline, category,
 * help link — comes from the database. Only the parts that cannot be serialised
 * live here: the icon component and its brand colour. That keeps adding a
 * connector a data change, while a slug with no entry still renders correctly
 * through the fallback rather than appearing broken.
 */
import {
  Blocks,
  BookOpen,
  Brain,
  Calendar,
  FileText,
  FolderOpen,
  GitBranch,
  Github,
  Globe,
  HardDrive,
  Hash,
  Mail,
  Table2,
  Terminal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { MCPServerCategory } from '../api/mcp';

export interface ConnectorVisual {
  icon: LucideIcon;
  /** Brand colour, used for the icon itself against a tinted tile. */
  color: string;
}

const VISUALS: Record<string, ConnectorVisual> = {
  'google-drive': { icon: HardDrive, color: '#1a73e8' },
  gmail: { icon: Mail, color: '#ea4335' },
  'google-calendar': { icon: Calendar, color: '#0f9d58' },
  'google-sheets': { icon: Table2, color: '#0f9d58' },
  'google-docs': { icon: FileText, color: '#1a73e8' },
  notion: { icon: BookOpen, color: '#8b8b8b' },
  slack: { icon: Hash, color: '#7c3aed' },
  github: { icon: Github, color: '#8b8b8b' },
  filesystem: { icon: FolderOpen, color: '#7c3aed' },
  fetch: { icon: Globe, color: '#0ea5e9' },
  memory: { icon: Brain, color: '#ec4899' },
  'sequential-thinking': { icon: GitBranch, color: '#f59e0b' },
};

/** Shown for a connector whose slug this build has never heard of. */
const FALLBACK: ConnectorVisual = { icon: Blocks, color: '#94a3b8' };

/** A user's own MCP server: a command line, not a brand. */
const CUSTOM: ConnectorVisual = { icon: Terminal, color: '#94a3b8' };

export function connectorVisual(
  iconSlug: string | undefined,
  isSystem: boolean
): ConnectorVisual {
  if (iconSlug && VISUALS[iconSlug]) return VISUALS[iconSlug];
  return isSystem ? FALLBACK : CUSTOM;
}

/**
 * Category copy. The backend stores the machine key; the words belong to the UI
 * because they are the page's own framing rather than a property of the server.
 */
export const CATEGORY_LABELS: Record<MCPServerCategory, string> = {
  google_workspace: 'Google Workspace',
  communication: 'Communication',
  productivity: 'Productivity',
  development: 'Development',
  utilities: 'Built in',
  custom: 'Custom',
};

export const CATEGORY_BLURBS: Record<MCPServerCategory, string> = {
  google_workspace:
    'Sign in once and the assistant can work with your mail, files, and calendar.',
  communication: 'Let the assistant read and post messages for you.',
  productivity: 'Connect the knowledge and task tools your team already uses.',
  development: 'Give the assistant access to your code and issues.',
  utilities: 'Always available. Nothing to set up.',
  custom: 'Connections you added yourself.',
};

/** Display order. Built-ins sit last: they need no attention. */
export const CATEGORY_ORDER: MCPServerCategory[] = [
  'google_workspace',
  'communication',
  'productivity',
  'development',
  'custom',
  'utilities',
];
