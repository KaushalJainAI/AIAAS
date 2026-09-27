/**
 * Display maps for extraction.
 *
 * These live outside the page components so a list and its detail page render a
 * status the same way. Keeping them in the page file also breaks fast refresh,
 * which is the immediate reason they moved — but the real one is that two
 * screens disagreeing about what "deployed" looks like is a bug you only notice
 * in a screenshot.
 */
import {
  Mail, HardDrive, Upload, type LucideIcon,
} from 'lucide-react';
import type { ExtractionSchema, RowStatus } from '../api/extraction';

export const sourceIcon: Record<ExtractionSchema['source_kind'], LucideIcon> = {
  gmail: Mail,
  gdrive: HardDrive,
  upload: Upload,
};

export const sourceLabel: Record<ExtractionSchema['source_kind'], string> = {
  gmail: 'Gmail',
  gdrive: 'Google Drive',
  upload: 'Manual upload',
};

export const rowStatusStyle: Record<RowStatus, string> = {
  accepted: 'text-muted-foreground bg-secondary',
  needs_review: 'text-destructive bg-destructive-subtle font-semibold',
  reviewed: 'text-success bg-success-subtle',
  rejected: 'text-muted-foreground bg-secondary line-through',
};


