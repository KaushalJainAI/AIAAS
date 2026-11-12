/**
 * Skills — reusable instructions an agent can be given.
 *
 * Two lists: the skills you own ("Mine") and the ones other people shared
 * ("Library"). A skill opens in a full-screen editor with the markdown on the
 * left and how it reads on the right. Laid out like Tools: a compact title
 * row, one toolbar, then a divided list rather than a wall of cards.
 */
import { useEffect, useState } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  GraduationCap,
  Plus,
  Share2,
  Trash2,
  X,
  Download,
  Search,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import skillsService, { type Skill, type SkillTab } from '../api/skills';
import MarkdownMessage from '../components/chat/MarkdownMessage';
import PageHeader from '../components/layout/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import Select from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { IconButton } from '../components/ui/IconButton';

/** One page holds a whole library; at 20 the tab said "(24)" over 20 cards. */
const SKILLS_PAGE_SIZE = 100;

const CATEGORIES = [
  'General',
  'Data Science',
  'Automation',
  'Development',
  'Marketing',
  'Security',
  'Finance',
  'Communication',
].map((c) => ({ value: c, label: c === 'Data Science' ? 'Data science' : c }));

type EditorMode = 'edit' | 'split' | 'preview';
const MODES: { key: EditorMode; label: string }[] = [
  { key: 'edit', label: 'Write' },
  { key: 'split', label: 'Split' },
  { key: 'preview', label: 'Preview' },
];

/** "Used by N agents" / "Not used yet"; nothing when an older server sent no count. */
function usageLabel(used: number | null | undefined): string {
  if (used == null) return '';
  if (used === 0) return 'Not used yet';
  return `Used by ${used} agent${used === 1 ? '' : 's'}`;
}

/** A bordered strip of buttons with the chosen one raised — same as Tools' filter. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shrink-0">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'h-7 px-2.5 rounded text-[12.5px] whitespace-nowrap transition-colors',
            value === o.key
              ? 'bg-secondary font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SkillRow({
  skill,
  mine,
  onOpen,
  onShare,
  onDelete,
  onIncorporate,
}: {
  skill: Skill;
  mine: boolean;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
  onIncorporate: () => void;
}) {
  const usage = usageLabel(skill.used_by);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group flex items-center gap-3 px-4 py-3 bg-card hover:bg-secondary transition-colors cursor-pointer',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-foreground truncate">
            {skill.title || 'Untitled skill'}
          </span>
          <span className="inline-flex items-center h-[20px] px-1.5 rounded bg-secondary text-[11px] text-muted-foreground shrink-0">
            {skill.category}
          </span>
          {mine && skill.isShared && (
            <span className="inline-flex items-center gap-1 h-[20px] px-1.5 rounded bg-success-subtle text-success text-[11px] font-medium shrink-0">
              <Users className="w-3 h-3" />
              Shared
            </span>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
          {skill.description || 'No description.'}
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground truncate">
          {mine ? usage || ' ' : [`By ${skill.author}`, usage].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {mine ? (
          <>
            <IconButton
              label={skill.isShared ? 'Stop sharing' : 'Share with everyone'}
              onClick={(e) => { e.stopPropagation(); onShare(); }}
              className={cn(skill.isShared && 'text-success')}
            >
              <Share2 className="w-4 h-4" />
            </IconButton>
            <IconButton
              label="Delete skill"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </IconButton>
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => { e.stopPropagation(); onIncorporate(); }}
            title="Copy into your skills"
          >
            <Download className="w-3.5 h-3.5" />
            Add to mine
          </Button>
        )}
      </div>
    </div>
  );
}

export default function Skills() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = usePersistedState('skills.search', '', { storage: 'session' });
  const [activeTab, setActiveTab] = usePersistedState<SkillTab>('skills.tab', 'mine');

  const { data: skillsData, isLoading, isError, refetch } = useQuery({
    queryKey: ['skills', activeTab, searchQuery],
    queryFn: () => skillsService.search(searchQuery, activeTab, SKILLS_PAGE_SIZE),
    staleTime: 5 * 60 * 1000,
  });

  // The other tab's count, as a one-row request. Each label used to show a
  // count only while its tab was open, so the closed one always read "(0)".
  const otherTab: SkillTab = activeTab === 'mine' ? 'public' : 'mine';
  const { data: otherData } = useQuery({
    queryKey: ['skills', otherTab, 'count'],
    // Browse mode (no query): a count must not cost an embedding search.
    queryFn: () => skillsService.search('', otherTab, 1),
    staleTime: 5 * 60 * 1000,
  });

  const currentSkills = skillsData?.results || [];
  const countOf = (tab: SkillTab) => (tab === activeTab ? skillsData?.total : otherData?.total);
  const tabLabel = (tab: SkillTab, name: string) => {
    const n = countOf(tab);
    return n === undefined ? name : `${name} · ${n}`;
  };

  // Editor state
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<Skill['id'] | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('General');
  const [editorMode, setEditorMode] = usePersistedState<EditorMode>('skills.editorMode', 'split');
  // A library skill is someone else's: it opens to read, and is copied to edit.
  const readOnly = selectedSkill !== null && activeTab === 'public';

  useEffect(() => {
    if (!isEditing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsEditing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEditing]);

  const handleCreateSkill = () => {
    setSelectedSkill(null);
    setEditTitle('');
    setEditDescription('');
    setEditContent('');
    setEditCategory('General');
    setIsEditing(true);
  };

  const handleOpenSkill = (skill: Skill) => {
    setSelectedSkill(skill);
    setEditTitle(skill.title);
    setEditDescription(skill.description);
    setEditContent(skill.content);
    setEditCategory(skill.category);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editTitle.trim()) {
      toast.error('Give the skill a title first.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: editTitle.trim(),
        description: editDescription,
        content: editContent,
        category: editCategory,
      };
      if (selectedSkill) {
        await skillsService.update(selectedSkill.id, payload);
        toast.success('Skill saved');
      } else {
        await skillsService.create(payload);
        toast.success('Skill created');
      }
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    } catch (error) {
      console.error('Failed to save skill:', error);
      toast.error('Could not save the skill');
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async (skill: Skill) => {
    try {
      toast.success(await skillsService.toggleShare(skill.id));
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    } catch (error) {
      console.error('Failed to share skill:', error);
      toast.error('Could not change sharing');
    }
  };

  const handleDelete = async (id: Skill['id']) => {
    try {
      await skillsService.remove(id);
      toast.success('Skill deleted');
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    } catch (error) {
      console.error('Failed to delete skill:', error);
      toast.error('Could not delete the skill');
    } finally {
      setPendingDeleteId(null);
    }
  };

  const handleIncorporate = async (skill: Skill) => {
    try {
      await skillsService.fork(skill.id);
      toast.success('Added to your skills');
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      setIsEditing(false);
      setActiveTab('mine');
    } catch (error) {
      console.error('Failed to incorporate skill:', error);
      toast.error('Could not add the skill');
    }
  };

  const mine = activeTab === 'mine';

  return (
    <div className="h-full flex flex-col bg-background">
      <PageHeader
        icon={GraduationCap}
        title="Skills"
        subtitle="Reusable instructions you can attach to any agent"
        actions={
          <Button size="sm" onClick={handleCreateSkill}>
            <Plus className="w-3.5 h-3.5" />
            New skill
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Segmented
              label="Which skills"
              value={activeTab}
              onChange={setActiveTab}
              options={[
                { key: 'mine', label: tabLabel('mine', 'Mine') },
                { key: 'public', label: tabLabel('public', 'Library') },
              ]}
            />
            <div className="group flex-1">
              <SearchInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={mine ? 'Search your skills…' : 'Search shared skills…'}
                className="h-9 text-[13px]"
                aria-label="Search skills"
              />
            </div>
          </div>

          {isLoading && currentSkills.length === 0 ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[72px] rounded-md bg-card border border-border animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center py-16 text-center">
              <p className="text-sm font-semibold">We couldn't load skills</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : currentSkills.length === 0 ? (
            searchQuery ? (
              <EmptyState icon={Search} title="No skill matches that" body="Try a different word." />
            ) : mine ? (
              <EmptyState
                icon={GraduationCap}
                title="No skills yet"
                body="A skill is a page of instructions — a checklist, a house style, a procedure — that any agent can be given."
                action={
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleCreateSkill}>
                      <Plus className="w-3.5 h-3.5" />
                      New skill
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setActiveTab('public')}>
                      Browse the library
                    </Button>
                  </div>
                }
              />
            ) : (
              <EmptyState icon={Users} title="Nothing shared yet" body="Skills other people share appear here." />
            )
          ) : (
            <div className="bg-card border border-border rounded-md overflow-hidden divide-y divide-border/60">
              {currentSkills.map((skill: Skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  mine={mine}
                  onOpen={() => handleOpenSkill(skill)}
                  onShare={() => handleShare(skill)}
                  onDelete={() => setPendingDeleteId(skill.id)}
                  onIncorporate={() => handleIncorporate(skill)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center md:p-6 animate-in fade-in duration-200">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selectedSkill ? 'Edit skill' : 'New skill'}
            className="bg-card border border-border w-full max-w-6xl h-full md:h-[90vh] md:rounded-md shadow-lg flex flex-col overflow-hidden"
          >
            {/* Title row: name and description on the left, view and save on the right. */}
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center">
              <div className="flex-1 min-w-0 space-y-1">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  readOnly={readOnly}
                  aria-label="Skill title"
                  className="w-full bg-transparent border-none p-0 text-[15px] font-semibold focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
                  placeholder="Skill title"
                  autoFocus={!selectedSkill}
                />
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  readOnly={readOnly}
                  aria-label="Short description"
                  className="w-full bg-transparent border-none p-0 text-[13px] text-muted-foreground focus:outline-none focus:ring-0 placeholder:text-muted-foreground/70"
                  placeholder="One line on what it is for"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {readOnly ? (
                  <span className="inline-flex items-center h-8 px-2.5 rounded bg-secondary text-[12px] text-muted-foreground">
                    {editCategory}
                  </span>
                ) : (
                  <Select
                    value={editCategory}
                    onChange={setEditCategory}
                    options={CATEGORIES}
                    className="w-40"
                  />
                )}
                <Segmented label="Editor view" value={editorMode} onChange={setEditorMode} options={MODES} />
                {readOnly && selectedSkill ? (
                  <Button size="sm" onClick={() => handleIncorporate(selectedSkill)}>
                    <Download className="w-3.5 h-3.5" />
                    Add to mine
                  </Button>
                ) : (
                  <Button size="sm" onClick={handleSave} loading={saving}>
                    Save
                  </Button>
                )}
                <IconButton label="Close" onClick={() => setIsEditing(false)}>
                  <X className="w-5 h-5" />
                </IconButton>
              </div>
            </div>

            <div className="flex-1 flex min-h-0">
              {editorMode !== 'preview' && !readOnly && (
                <div className={cn('flex-1 min-w-0 flex flex-col bg-background', editorMode === 'split' && 'md:border-r border-border')}>
                  <div className="label-mono px-4 pt-3">Markdown</div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    aria-label="Skill instructions"
                    placeholder={'# What the agent should do\n\n- Step one\n- Step two'}
                    spellCheck={false}
                    className="flex-1 w-full resize-none bg-transparent border-none px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0"
                  />
                </div>
              )}
              {(editorMode !== 'edit' || readOnly) && (
                <div className={cn('flex-1 min-w-0 overflow-y-auto custom-scrollbar', editorMode === 'split' && !readOnly && 'hidden md:block')}>
                  <div className="label-mono px-4 md:px-8 pt-3">Preview</div>
                  <div className="max-w-3xl mx-auto px-4 md:px-8 py-4">
                    {editContent.trim() ? (
                      <MarkdownMessage content={editContent} variant="full" />
                    ) : (
                      <p className="text-[13px] text-muted-foreground">Nothing written yet.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {pendingDeleteId !== null && (
        <ConfirmDialog
          title="Delete skill?"
          body="This removes the skill from your collection. This cannot be undone."
          confirmLabel="Delete"
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={() => handleDelete(pendingDeleteId)}
        />
      )}
    </div>
  );
}
