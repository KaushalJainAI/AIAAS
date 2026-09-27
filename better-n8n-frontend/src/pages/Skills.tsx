import { useState } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  GraduationCap,
  Search,
  Plus,
  FileText,
  Share2,
  Trash2,
  X,
  Loader2,
  Edit3,
  Eye,
  Check,
  Download,
  ChevronDown
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import skillsService, { type Skill, type SkillTab } from '../api/skills';
import MarkdownMessage from '../components/chat/MarkdownMessage';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { IconButton } from '../components/ui/IconButton';
import SidebarMenuButton from '../components/layout/SidebarMenuButton';

export default function Skills() {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = usePersistedState('skills.search', '', { storage: 'session' });
    const [activeTab, setActiveTab] = usePersistedState<SkillTab>('skills.tab', 'mine');

    // Skills Data from React Query
    const { data: skillsData, isLoading } = useQuery({
        queryKey: ['skills', activeTab, searchQuery],
        queryFn: () => skillsService.search(searchQuery, activeTab),
        staleTime: 5 * 60 * 1000,
    });
    
    const currentSkills = skillsData?.results || [];
    const totalMy = activeTab === 'mine' ? (skillsData?.total || 0) : 0;
    const totalPublic = activeTab === 'public' ? (skillsData?.total || 0) : 0;

    // Editor State
    const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<Skill['id'] | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editCategory, setEditCategory] = useState('General');
    const [editorMode, setEditorMode] = usePersistedState<'split' | 'edit' | 'preview'>('skills.editorMode', 'split');



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
        try {
            const payload = {
                title: editTitle,
                description: editDescription,
                content: editContent,
                category: editCategory
            };

            if (selectedSkill) {
                await skillsService.update(selectedSkill.id, payload);
                toast.success('Skill updated successfully');
            } else {
                await skillsService.create(payload);
                toast.success('Skill created successfully');
            }
            setIsEditing(false);
            queryClient.invalidateQueries({ queryKey: ['skills'] });
        } catch (error) {
            console.error('Failed to save skill:', error);
            toast.error('Failed to save skill');
        }
    };

    const handleShare = async (skill: Skill) => {
        try {
            toast.success(await skillsService.toggleShare(skill.id));
            queryClient.invalidateQueries({ queryKey: ['skills'] });
        } catch (error) {
            console.error('Failed to share skill:', error);
            toast.error('Failed to update sharing status');
        }
    };

    const handleDelete = async (id: Skill['id']) => {
        try {
            await skillsService.remove(id);
            toast.success('Skill deleted');
            queryClient.invalidateQueries({ queryKey: ['skills'] });
        } catch (error) {
            console.error('Failed to delete skill:', error);
            toast.error('Failed to delete skill');
        } finally {
            setPendingDeleteId(null);
        }
    };

    const handleIncorporate = async (skill: Skill) => {
        try {
            await skillsService.fork(skill.id);
            toast.success('Skill incorporated into your collection!');
            queryClient.invalidateQueries({ queryKey: ['skills'] });
            setActiveTab('mine');
        } catch (error) {
            console.error('Failed to incorporate skill:', error);
            toast.error('Failed to incorporate skill');
        }
    };

    return (
        // `h-full`, not `h-screen` — see the note in Documents.tsx.
        <div className="flex flex-col h-full bg-background text-foreground animate-in fade-in duration-500">
            {/* Header — spacing follows PageHeader (px-4 py-6 md:px-8 md:py-8). */}
            <header className="px-4 py-6 md:px-8 md:py-8 bg-card sticky top-0 z-20 border-b border-border">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3 md:gap-4 min-w-0">
                        <SidebarMenuButton />
                        <div className="p-2.5 md:p-3 bg-primary/10 rounded-lg shrink-0">
                            <GraduationCap className="w-5 h-5 md:w-6 md:h-6 text-primary" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-xl md:text-2xl font-bold">Skills</h1>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Build, manage, and share AI skills to enhance your workflows
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleCreateSkill}
                        className="flex items-center gap-2 px-4 h-10 bg-primary text-primary-foreground rounded-lg text-sm font-semibold whitespace-nowrap transition-colors hover:bg-primary/90"
                    >
                        <Plus className="w-4 h-4" />
                        Create skill
                    </button>
                </div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-8">
                        <button
                            onClick={() => {
                                setActiveTab('mine');
                            }}
                            className={cn(
                                "pb-3 text-sm font-semibold transition-all relative",
                                activeTab === 'mine' ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        My Skills ({totalMy})
                        {activeTab === 'mine' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab('public');
                        }}
                        className={cn(
                            "pb-3 text-sm font-semibold transition-all relative",
                            activeTab === 'public' ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        Public Library ({totalPublic})
                        {activeTab === 'public' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                    </button>
                </div>

                <div className="relative w-full md:w-[400px] group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <input
                        type="text"
                        placeholder="Search skills..."
                        className="w-full h-11 pl-11 pr-4 rounded-lg bg-background border border-border focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-colors text-foreground placeholder:text-muted-foreground shadow-sm"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {isLoading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />}
                </div>
            </div>
        </header>

        {/* Main Content — matches the Tools page content gutter. */}
        <main className="flex-1 overflow-auto px-4 md:px-8 py-6">
            <div className="max-w-7xl mx-auto">
                {isLoading && currentSkills.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                        <span className="text-muted-foreground animate-pulse">Loading skills...</span>
                    </div>
                ) : !isLoading && currentSkills.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center max-w-sm mx-auto">
                        <div className="p-6 bg-muted rounded-full mb-6">
                            <Search className="w-12 h-12 text-muted-foreground/40" />
                        </div>
                        <h3 className="text-xl font-bold text-foreground mb-2">No skills found</h3>
                        <p className="text-muted-foreground text-sm mb-8">
                            {searchQuery ? "Try adjusting your search terms." : "You haven't created any skills yet."}
                        </p>
                        {!searchQuery && activeTab === 'mine' && (
                            <button 
                                onClick={handleCreateSkill}
                                className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg font-bold text-sm hover:bg-primary/90 transition-all"
                            >
                                <Plus className="w-4 h-4" />
                                Create your first skill
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 stagger-children">
                        {currentSkills.map((skill: Skill) => (
                            <div 
                                key={skill.id}
                                onClick={() => handleOpenSkill(skill)}
                                className="group relative bg-card border border-border/60 rounded-lg p-6 transition-all hover:border-primary/40 cursor-pointer flex flex-col h-[240px]"
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className="p-3 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                                        <FileText className="w-5 h-5 text-primary" />
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-colors">
                                        {activeTab === 'mine' ? (
                                            <>
                                                <IconButton
                                                    label="Share skill"
                                                    onClick={(e) => { e.stopPropagation(); handleShare(skill); }}
                                                >
                                                    <Share2 className="w-4 h-4" />
                                                </IconButton>
                                                <IconButton
                                                    label="Delete skill"
                                                    onClick={(e) => { e.stopPropagation(); setPendingDeleteId(skill.id); }}
                                                    className="hover:text-destructive"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </IconButton>
                                            </>
                                        ) : (
                                            <button 
                                                onClick={(e) => { 
                                                    e.stopPropagation(); 
                                                    handleIncorporate(skill);
                                                }}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground rounded-lg text-xs font-bold transition-all"
                                                title="Incorporate to My Skills"
                                            >
                                                <Download className="w-3.5 h-3.5" />
                                                Incorporate
                                            </button>
                                        )}
                                    </div>
                                </div>
                                
                                <h3 className="font-bold text-lg text-foreground mb-2 line-clamp-1">{skill.title}</h3>
                                <p className="text-sm text-muted-foreground mb-4 flex-1 line-clamp-3 leading-relaxed">
                                    {skill.description}
                                </p>
                                
                                <div className="pt-4 border-t border-border/60 flex items-center justify-between text-[11px] font-bold ">
                                    <span className="text-primary/70">{skill.category}</span>
                                    <span className="text-muted-foreground">By {skill.author}</span>
                                </div>

                                {skill.isShared && activeTab === 'mine' && (
                                    <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-green-500 text-white text-[10px] font-bold rounded-lg shadow-sm">
                                        Shared
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>

            {/* Markdown Editor Modal */}
            {isEditing && (
                <div className="fixed inset-0 z-50 bg-black/50 flex flex-col items-center justify-center animate-in fade-in duration-200">
                    <div className="bg-card border border-border/60 w-full max-w-6xl h-[90vh] rounded-lg shadow-lg flex flex-col overflow-hidden entrance-modal">
                        {/* Modal Header */}
                        <div className="p-4 md:p-6 border-b border-border/60 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-card">
                            <div className="flex items-center gap-2 md:gap-4 flex-1 lg:mr-4">
                                <div className="p-2 bg-primary/10 rounded-lg">
                                    <Edit3 className="w-5 h-5 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <input 
                                        value={editTitle}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        className="bg-transparent border-none p-0 text-xl font-bold focus:ring-0 w-full placeholder:text-muted-foreground"
                                        placeholder="Skill Title"
                                    />
                                    <div className="flex items-center gap-3 mt-1 min-w-0">
                                        <input 
                                            value={editDescription}
                                            onChange={(e) => setEditDescription(e.target.value)}
                                            className="bg-transparent border-none p-0 text-sm text-muted-foreground focus:ring-0 flex-1 min-w-0"
                                            placeholder="Short description..."
                                        />
                                        <div className="relative shrink-0">
                                            <select
                                                value={editCategory}
                                                onChange={(e) => setEditCategory(e.target.value)}
                                                className="appearance-none bg-secondary text-secondary-foreground text-xs font-semibold pl-3 pr-8 py-1.5 rounded-full border border-border/50 hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 cursor-pointer transition-colors leading-none h-7"
                                            >
                                                <option value="General">General</option>
                                                <option value="Data Science">Data science</option>
                                                <option value="Automation">Automation</option>
                                                <option value="Development">Development</option>
                                                <option value="Marketing">Marketing</option>
                                                <option value="Security">Security</option>
                                                <option value="Finance">Finance</option>
                                                <option value="Communication">Communication</option>
                                            </select>
                                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="flex items-center bg-muted p-1 rounded-lg lg:mr-4 w-full justify-between sm:w-auto">
                                    <button 
                                        onClick={() => setEditorMode('edit')}
                                        className={cn(
                                            "p-1.5 px-3 rounded-md text-xs font-bold transition-all flex items-center gap-2",
                                            editorMode === 'edit' ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <Edit3 className="w-4 h-4" />
                                        Code
                                    </button>
                                    <button 
                                        onClick={() => setEditorMode('split')}
                                        className={cn(
                                            "p-1.5 px-3 rounded-md text-xs font-bold transition-all flex items-center gap-2",
                                            editorMode === 'split' ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        Split
                                    </button>
                                    <button 
                                        onClick={() => setEditorMode('preview')}
                                        className={cn(
                                            "p-1.5 px-3 rounded-md text-xs font-bold transition-all flex items-center gap-2",
                                            editorMode === 'preview' ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <Eye className="w-4 h-4" />
                                        Preview
                                    </button>
                                </div>
                                
                                <button 
                                    onClick={handleSave}
                                    className="px-6 py-2 bg-primary text-white rounded-lg font-bold text-sm transition-all shadow-sm flex items-center gap-2"
                                >
                                    <Check className="w-4 h-4" />
                                    Save skill
                                </button>
                                <button 
                                    onClick={() => setIsEditing(false)}
                                    className="p-2 hover:bg-muted rounded-lg transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                        </div>

                        {/* Editor Body */}
                        <div className="flex-1 flex overflow-hidden">
                            {(editorMode === 'edit' || editorMode === 'split') && (
                                <div className={cn(
                                    "flex-1 overflow-auto bg-zinc-950/50 p-6 font-mono",
                                    editorMode === 'split' && "border-r border-border/60"
                                )}>
                                    <textarea 
                                        value={editContent}
                                        onChange={(e) => setEditContent(e.target.value)}
                                        className="w-full h-full bg-transparent border-none text-blue-400 focus:ring-0 p-0 resize-none font-mono text-sm leading-relaxed"
                                        style={{ outline: 'none' }}
                                    />
                                </div>
                            )}
                            {(editorMode === 'preview' || editorMode === 'split') && (
                                <div className="flex-1 overflow-auto bg-card p-4 md:p-8 max-w-none">
                                    <div className="max-w-3xl mx-auto">
                                        {/* Full markdown via the shared renderer. */}
                                        <MarkdownMessage content={editContent} variant="full" />
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
