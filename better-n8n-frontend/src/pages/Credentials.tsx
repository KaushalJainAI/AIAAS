import { useState } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import { toast } from 'sonner';
import { 
  Plus, 
  MoreVertical,
  Key,
  Globe,
  Mail,
  Database,
  MessageSquare,
  Cloud,
  Shield,
  X,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Check,
  Copy,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import { credentialsService } from '../api/credentials';
import type { Credential, CredentialType } from '../api/credentials';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import CredentialModal from '../components/credentials/CredentialModal';
import PageHeader from '../components/layout/PageHeader';
import SearchInput from '../components/ui/SearchInput';
import { cn } from '../lib/utils';

// Icon mapper
// Keyed by the `icon` string the backend stores, so a new credential type
// is a fixture row rather than a code change here.
const IconMap: Record<string, LucideIcon> = {
  'Mail': Mail,
  'Database': Database,
  'MessageSquare': MessageSquare,
  'Cloud': Cloud,
  'Key': Key,
  'Globe': Globe,
  'Shield': Shield
};

/** Group rows by provider display name, providers A–Z, newest first inside. */
function groupByType(rows: Credential[]): { type: string; items: Credential[] }[] {
  const groups = new Map<string, Credential[]>();
  for (const c of rows) {
    const key = c.credential_type_display || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, items]) => ({ type, items }));
}

export default function Credentials() {
  const [searchQuery, setSearchQuery] = usePersistedState('credentials.search', '', { storage: 'session' });
  const [statusFilter, setStatusFilter] = usePersistedState<'all' | 'verified' | 'unverified'>('credentials.filter', 'all');
  const [showModal, setShowModal] = useState(false);
  const [editingCredential, setEditingCredential] = useState<Credential | null>(null);
  const [viewingCredential, setViewingCredential] = useState<Credential | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['credentialsData'],
    queryFn: async () => {
      const [credsRes, typesRes] = await Promise.all([
        credentialsService.list(),
        credentialsService.getTypes()
      ]);
      return {
        credentials: credsRes?.credentials ?? (Array.isArray(credsRes) ? credsRes : []),
        types: typesRes?.types ?? (Array.isArray(typesRes) ? typesRes : []),
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const credentials = data?.credentials || [];
  const credentialTypes = data?.types || [];
  const error = queryError ? 'Failed to load credentials. Ensure backend is running.' : null;

  const filteredCredentials = credentials.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.credential_type_display.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleFieldVisibility = (fieldKey: string) => {
    const newVisible = new Set(visibleFields);
    if (newVisible.has(fieldKey)) {
      newVisible.delete(fieldKey);
    } else {
      newVisible.add(fieldKey);
    }
    setVisibleFields(newVisible);
  };

  const copyToClipboard = (value: string, fieldKey: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleDeleteCredential = async (id: number) => {
    try {
      await credentialsService.delete(id);
      setShowDeleteConfirm(null);
      setOpenDropdown(null);
      queryClient.invalidateQueries({ queryKey: ['credentialsData'] });
    } catch (err) {
      console.error('Failed to delete credential', err);
    }
  };

  const handleVerifyCredential = async (id: number) => {
    try {
      const result = await credentialsService.verify(id);
      if (result.valid) {
        queryClient.invalidateQueries({ queryKey: ['credentialsData'] });
        
        if (viewingCredential?.id === id) {
            setViewingCredential(prev => prev ? { ...prev, is_verified: true } : null);
        }
        toast.success('Credential verified successfully!');
      } else {
        toast.error(`Verification failed: ${result.message}`);
      }
    } catch (err) {
      console.error('Verification failed', err);
      toast.error('Verification failed. See console for details.');
    }
  };

  const renderIcon = (iconName: string) => {
    const Icon = IconMap[iconName] || Key;
    return <Icon className="w-5 h-5" />;
  };

  const verifiedCredentials = filteredCredentials.filter(c => c.is_verified);
  const unverifiedCredentials = filteredCredentials.filter(c => !c.is_verified);

  // One list: verified and unverified side by side, grouped by provider so a
  // key added but not yet verified never looks "lost" on another tab.
  const visibleCredentials = filteredCredentials.filter(c =>
    statusFilter === 'all' ? true : statusFilter === 'verified' ? c.is_verified : !c.is_verified,
  );
  const groupedCredentials = groupByType(visibleCredentials);

  const renderCredentialCard = (credential: Credential) => (
    <div
      key={credential.id}
      className="group relative bg-card border border-border rounded-lg p-6 card-hover cursor-pointer flex flex-col"
      onClick={() => setViewingCredential(credential)}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
            {(() => {
                const type = credentialTypes.find(t => t.id === credential.credential_type);
                return renderIcon(type?.icon || 'Key');
            })()}
          </div>
          <div>
            <h3 className="font-bold text-lg text-foreground mb-1 group-hover:text-primary transition-colors line-clamp-1">
              {credential.name}
            </h3>
            <p className="text-xs font-medium text-muted-foreground ">{credential.credential_type_display}</p>
          </div>
        </div>
        <div className="relative">
          <button 
            className="p-1.5 hover:bg-muted rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Credential actions"
            aria-expanded={openDropdown === credential.id}
            onClick={(e) => {
              e.stopPropagation();
              setOpenDropdown(openDropdown === credential.id ? null : credential.id);
            }}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          
          {openDropdown === credential.id && (
            <div role="menu" className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-10 py-1 min-w-32 entrance-modal">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewingCredential(credential);
                  setOpenDropdown(null);
                }}
              >
                <Eye className="w-4 h-4" />
                View
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingCredential(credential);
                  setShowModal(true);
                  setOpenDropdown(null);
                }}
              >
                <Edit className="w-4 h-4" />
                Edit
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                onClick={(e) => {
                    e.stopPropagation();
                    handleVerifyCredential(credential.id);
                    setOpenDropdown(null);
                }}
              >
                <Shield className="w-4 h-4 text-green-600" />
                Verify
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(credential.id);
                  setOpenDropdown(null);
                }}
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/60 space-y-2">
        {!credential.is_verified && credential.last_error && (
          <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed line-clamp-2" title={credential.last_error}>
            {credential.last_error}
          </p>
        )}
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <div className="flex items-center gap-1.5">
            {credential.is_verified ? (
               <Check className="w-3 h-3 text-green-500" />
            ) : (
               <Shield className="w-3 h-3 text-amber-500" />
            )}
            <span className={credential.is_verified ? "text-green-500 font-bold" : "text-amber-600 font-bold"}>{credential.is_verified ? 'Verified' : 'Needs verification'}</span>
          </div>
          {!credential.is_verified ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleVerifyCredential(credential.id);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-success-subtle text-success border border-border text-xs font-semibold hover:bg-success-subtle/80 transition-colors"
            >
              <Shield className="w-3 h-3" />
              Verify
            </button>
          ) : (
            <span>{new Date(credential.updated_at).toLocaleDateString()}</span>
          )}
        </div>
    </div>
  );

  if (loading && credentials.length === 0) {
    return <div className="p-6 text-center text-muted-foreground">Loading credentials...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <PageHeader 
        title="Credentials"
        subtitle="Manage your external service connections"
        icon={Key}
        actions={
          <button 
            onClick={() => {
                setEditingCredential(null);
                setShowModal(true);
            }}
            className="btn-primary px-4 py-2"
          >
            <Plus className="w-4 h-4" />
            Add Credential
          </button>
        }
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-semibold">
              <Check className="w-3.5 h-3.5" />
              {verifiedCredentials.length} verified
            </span>
            {unverifiedCredentials.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 font-semibold">
                <Shield className="w-3.5 h-3.5" />
                {unverifiedCredentials.length} need verification
              </span>
            )}
            <div className="ml-2 flex items-center gap-1 border border-border rounded-full p-0.5">
              {(['all', 'verified', 'unverified'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-semibold transition-colors",
                    statusFilter === f ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f === 'all' ? 'All' : f === 'verified' ? 'Verified' : 'Needs verification'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end">
            <div className="relative w-full md:w-[400px]">
              <SearchInput
                placeholder="Search credentials..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>
      </PageHeader>

      {error && (
        <div className="bg-destructive/10 text-destructive p-4 border-b border-destructive/20 flex items-center gap-2">
           <AlertCircle className="w-5 h-5" />
           {error}
        </div>
      )}

      {/* Credentials — one list grouped by provider. Verified and unverified
          stay on the same page so a new key never looks lost before Verify. */}
      <div className="flex-1 overflow-auto p-4 md:p-8 space-y-10 animate-in fade-in duration-500">
        {unverifiedCredentials.length > 0 && statusFilter === 'all' && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            {unverifiedCredentials.length} credential{unverifiedCredentials.length === 1 ? '' : 's'} {unverifiedCredentials.length === 1 ? 'needs' : 'need'} verification — only verified keys are used for AI calls. Press Verify on the card.
          </div>
        )}
        {groupedCredentials.map(group => (
          <section key={group.type}>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">{group.type} ({group.items.length})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 stagger-children">
              {group.items.map(renderCredentialCard)}
            </div>
          </section>
        ))}

        {/* Empty State */}
        {visibleCredentials.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-20 entrance-overlay">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6 bg-muted/30">
              {statusFilter === 'verified' ? (
                <Check className="w-10 h-10 text-emerald-500" />
              ) : (
                <Shield className="w-10 h-10 text-muted-foreground/50" />
              )}
            </div>
            <h3 className="text-xl font-semibold mb-2">
              {filteredCredentials.length === 0
                ? "No credentials yet"
                : statusFilter === 'verified' ? "No verified credentials" : "Everything is verified"}
            </h3>
            <p className="text-muted-foreground mb-6 max-w-sm text-center">
              {filteredCredentials.length === 0
                ? "Add your first provider key — then press Verify so it can be used for AI calls."
                : statusFilter === 'verified'
                  ? "You haven't verified any credentials yet. Press Verify on a card to ensure it works."
                  : statusFilter === 'unverified'
                    ? "All your credentials are verified. Great job!"
                    : "No credentials match this search."}
            </p>
            {filteredCredentials.length === 0 && (
              <button
                onClick={() => {
                    setEditingCredential(null);
                    setShowModal(true);
                }}
                className="btn-primary px-4 py-2"
              >
                <Plus className="w-5 h-5" />
                Add First Credential
              </button>
            )}
          </div>
        )}
      </div>

      <CredentialModal 
        isOpen={showModal}
        onClose={() => {
            setShowModal(false);
            setEditingCredential(null);
        }}
        initialData={editingCredential}
        credentialTypes={credentialTypes as CredentialType[]}
        onSave={() => queryClient.invalidateQueries({ queryKey: ['credentialsData'] })}
      />

      {/* View Credential Modal */}
      {viewingCredential && (
        <div className="overlay flex items-center justify-center z-50 entrance-overlay">
          <div className="modal w-full max-w-lg mx-4 entrance-modal">
             {/* ... View Mode Content Stays ... */}
            <div className="p-6 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted/80 rounded-lg">
                   {(() => {
                        const type = credentialTypes.find(t => t.id === viewingCredential.credential_type);
                        return renderIcon(type?.icon || 'Key');
                    })()}
                </div>
                <div>
                  <h2 className="text-xl font-semibold">{viewingCredential.name}</h2>
                  <p className="text-sm text-muted-foreground">{viewingCredential.credential_type_display}</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setViewingCredential(null);
                  setVisibleFields(new Set());
                }}
                className="p-1.5 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {viewingCredential.fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium mb-1">{field.label}</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2 bg-muted rounded-md font-mono text-sm break-all min-h-[38px] flex items-center text-foreground">
                      {field.type === 'password' && !visibleFields.has(field.key)
                        ? '••••••••••••'
                        : (field.value || <span className="text-muted-foreground italic opacity-50">Empty</span>)}
                    </div>
                    {field.type === 'password' && (
                      <button
                        onClick={() => toggleFieldVisibility(field.key)}
                        className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground"
                        title={visibleFields.has(field.key) ? 'Hide' : 'Show'}
                      >
                        {visibleFields.has(field.key) ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => copyToClipboard(field.value, field.key)}
                      className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-foreground"
                      title="Copy"
                    >
                      {copiedField === field.key ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-border flex justify-between">
              <div className="text-sm text-muted-foreground">
                <p>Created: {new Date(viewingCredential.created_at).toLocaleDateString()}</p>
                <p>Updated: {new Date(viewingCredential.updated_at).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2">
                <button 
                    onClick={() => handleVerifyCredential(viewingCredential.id)}
                    className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg bg-success-subtle text-success hover:bg-success-subtle/80 transition-colors"
                >
                    <Shield className="w-4 h-4" />
                    Verify
                </button>
                <button 
                  onClick={() => {
                    setEditingCredential(viewingCredential);
                    setShowModal(true);
                    setViewingCredential(null);
                  }}
                  className="flex items-center gap-2 px-4 py-2 border border-border/60 rounded-lg hover:bg-muted transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="overlay flex items-center justify-center z-50 entrance-overlay">
          <div className="modal w-full max-w-sm mx-4 p-6 entrance-modal">
            <h3 className="text-lg font-semibold mb-2">Delete credential?</h3>
            <p className="text-muted-foreground mb-4">
              This action cannot be undone. Workflows using this credential will stop working.
            </p>
            <div className="flex justify-end gap-2">
              <button 
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 border border-border/60 rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleDeleteCredential(showDeleteConfirm)}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
