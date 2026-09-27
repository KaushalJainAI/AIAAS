import { useState } from 'react';
import { 
  X, 
  Eye, 
  EyeOff, 
  Mail, 
  Database, 
  MessageSquare, 
  Cloud, 
  Key, 
  Globe, 
  Shield,
  Brain,
  Search,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';
import { credentialsService, type CredentialType, type Credential } from '../../api/credentials';
import { handleApiError } from '../../api/client';
import Select from '../ui/Select';

import { toast } from 'sonner';
import { apiErrorMessage } from '../../lib/apiError';

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
  'Shield': Shield,
  'Brain': Brain,
  'Search': Search
};

interface CredentialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (credential: Credential) => void;
  initialData?: Credential | null;
  preselectedType?: CredentialType | null;
  credentialTypes: CredentialType[];
}

export default function CredentialModal({
  isOpen,
  onClose,
  onSave,
  initialData,
  preselectedType,
  credentialTypes,
}: CredentialModalProps) {
  const [name, setName] = useState('');
  const [selectedType, setSelectedType] = useState<CredentialType | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  // Snapshot of what the server handed us. Secrets come back masked
  // ("********ab12"), so anything still equal to its snapshot was not retyped
  // and must not be sent back — the backend would store the mask verbatim.
  const [loadedData, setLoadedData] = useState<Record<string, string>>({});
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Reset the form when the modal opens or is pointed at a different record.
  // Adjusted during render rather than in an effect: an effect paints the
  // previous record's values for one frame and then re-renders to replace
  // them, which is the cascading render React's docs (and the compiler's
  // lint) steer away from. Same trigger as the effect had: any change to
  // these inputs while open.
  const resetInputs = [isOpen, initialData, credentialTypes, preselectedType] as const;
  const [seenInputs, setSeenInputs] = useState<typeof resetInputs | null>(null);
  if (!seenInputs || resetInputs.some((input, i) => input !== seenInputs[i])) {
    setSeenInputs(resetInputs);
    if (isOpen) {
      setError(null);
      if (initialData) {
        // Edit Mode
        setName(initialData.name);
        // Find existing type
        const type = credentialTypes.find(t => t.id === initialData.credential_type);
        setSelectedType(type || null);
        
        // Populate fields
        const fields: Record<string, string> = {};
        initialData.fields.forEach(f => {
           fields[f.key] = f.value;
        });
        setFormData(fields);
        setLoadedData(fields);
      } else {
        // Create Mode — pointed at a type when opened from a connection card.
        setName('');
        setSelectedType(preselectedType ?? null);
        setFormData({});
        setLoadedData({});
        setSearchTerm('');
      }
    }
  }

  const handleSelectType = (type: CredentialType) => {
    setSelectedType(type);
    // Initialize fields with defaults
    const newFields: Record<string, string> = {};
    type.fields_schema.forEach(field => {
      newFields[field.name] = field.default || '';
    });
    setFormData(newFields);
    setLoadedData({});
  };

  const toggleFieldVisibility = (fieldKey: string) => {
    const newVisible = new Set(visibleFields);
    if (newVisible.has(fieldKey)) {
      newVisible.delete(fieldKey);
    } else {
      newVisible.add(fieldKey);
    }
    setVisibleFields(newVisible);
    setVisibleFields(newVisible);
  };

  const handleOAuthConnect = async () => {
    if (!selectedType) return;

    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    // The backend does not expose an /authorize/ redirect; it hands back the
    // provider URL from /oauth/google/init/ (authenticated, so it has to go
    // through apiClient rather than a bare window.open on the API host).
    let url: string;
    try {
      const res = await credentialsService.initGoogleOAuth(
        `${window.location.origin}/oauth/callback`
      );
      url = res.url;
    } catch (err: unknown) {
      toast.error(handleApiError(err).message || 'Could not start the OAuth flow');
      return;
    }

    window.open(
      url, 
      'OAuth Authorization', 
      `width=${width},height=${height},top=${top},left=${left}`
    );
    
    // Listen for success message
    const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'OAUTH_SUCCESS') {
            toast.success('Account connected successfully!');
            // Here we might update the form data with returned tokens or status
            window.removeEventListener('message', handleMessage);
        }
    };
    window.addEventListener('message', handleMessage);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!selectedType && !initialData) {
       setError('Please select a credential type');
       return;
    }
    // The backend stores whatever it is given without checking the type's
    // schema, so required fields have to be enforced here or a credential
    // saves fine and then fails at run time.
    const missing = (selectedType?.auth_method === 'oauth2' ? [] : selectedType?.fields_schema || [])
      .filter(f => f.required && !(formData[f.name] || '').trim())
      .map(f => f.label);
    if (missing.length > 0) {
       setError(`Required: ${missing.join(', ')}`);
       return;
    }

    try {
      setSaving(true);
      setError(null);
      
      let result: Credential;

      if (initialData) {
        // Update: send only the fields the user actually edited. The backend
        // merges them over the stored values, so untouched secrets keep their
        // real value instead of being overwritten with the display mask.
        const updateData: Record<string, string> = {};
        Object.entries(formData).forEach(([key, value]) => {
           if (value !== undefined && value !== loadedData[key]) {
             updateData[key] = value;
           }
        });

        result = await credentialsService.update(initialData.id, {
          name,
          data: updateData
        });
        toast.success('Credential updated');
      } else if (selectedType) {
        // Create
        result = await credentialsService.create({
          name,
          credential_type: selectedType.id,
          data: formData
        });
        toast.success('Credential created');
      } else {
        throw new Error('Invalid state');
      }

      if (onSave) onSave(result);
      onClose();
    } catch (err: unknown) {
      console.error('Save failed', err);
      setError(apiErrorMessage(err, 'Failed to save credential'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-semibold">
              {initialData ? 'Edit Credential' : 'New Credential'}
            </h2>
            {selectedType && (
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                    {(() => {
                        const Icon = IconMap[selectedType.icon || 'Key'] || Key;
                        return <Icon className="w-4 h-4" />;
                    })()}
                    {selectedType.name}
                </p>
            )}
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-muted rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {error && (
            <div className="mb-6 p-3 bg-red-50 text-red-600 border border-red-200 rounded-md text-sm flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-red-600" />
              {error}
            </div>
          )}

           {/* Type Selection (Create Mode Only) */}
          {!initialData && !selectedType && (
             <div className="space-y-4">
               <div>
                 <label className="block text-sm font-medium mb-3 text-muted-foreground">Select credential type</label>
                 
                 <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input 
                        type="text"
                        placeholder="Search for a service or node..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        autoFocus
                    />
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
                    {credentialTypes
                        .filter(type => 
                            type.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            type.description?.toLowerCase().includes(searchTerm.toLowerCase())
                        )
                        .map(type => {
                        const Icon = IconMap[type.icon || 'Key'] || Key;
                        return (
                          <button
                            key={type.id}
                            onClick={() => handleSelectType(type)}
                            className="flex items-start gap-4 p-4 border border-border rounded-xl hover:bg-accent/50 hover:border-primary/50 transition-all text-left group bg-card"
                          >
                             <div className="p-2.5 bg-muted rounded-lg group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                <Icon className="w-6 h-6" />
                             </div>
                             <div>
                                <div className="font-semibold text-foreground group-hover:text-primary transition-colors mb-1">{type.name}</div>
                                <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{type.description}</div>
                             </div>
                          </button>
                        );
                    })}
                    {credentialTypes.length > 0 && credentialTypes.filter(t => t.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                        <div className="col-span-2 text-center py-8 text-muted-foreground">
                            <p>No matching services found.</p>
                        </div>
                    )}
                 </div>
               </div>
             </div>
          )}
          
          {/* Form */}
          {(selectedType || initialData) && (
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1">Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Credential"
                  className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>
              
              {/* OAuth types are populated by the provider — the token fields
                  below are written by the callback, not typed in by hand. */}
              {selectedType?.auth_method === 'oauth2' && (
                <div className="p-4 border border-border rounded-lg bg-muted/30 space-y-2">
                  <p className="text-sm">
                    Connect your account to authorize access. Tokens are stored
                    and refreshed automatically.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Callback URL: <code className="bg-muted p-1 rounded">{window.location.origin}/oauth/callback</code>
                  </p>
                  <button
                    type="button"
                    onClick={handleOAuthConnect}
                    className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground text-xs rounded-md hover:bg-secondary/80 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Connect account
                  </button>
                </div>
              )}

              {/* Dynamic Fields */}
              {selectedType?.auth_method !== 'oauth2' && selectedType?.fields_schema.map((field) => (
                <div key={field.name}>
                   <label className="block text-sm font-medium mb-1">
                      {field.label}
                      {field.required && <span className="text-red-500">*</span>}
                   </label>
                   
                   {field.type === 'select' ? (
                       <Select
                          value={formData[field.name] || ''}
                          onChange={(val) => setFormData({...formData, [field.name]: val})}
                          options={[
                            { value: '', label: 'Select...' },
                            ...(field.options?.map(opt => ({ value: opt.value, label: opt.label })) || [])
                          ]}
                          className="w-full"
                       />
                   ) : field.type === 'textarea' ? (
                        <textarea
                           value={formData[field.name] || ''}
                           onChange={(e) => setFormData({...formData, [field.name]: e.target.value})}
                           rows={3}
                           className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm"
                        />
                   ) : (
                       <div className="relative">
                           <input
                              type={field.type === 'password' && !visibleFields.has(field.name) ? 'password' : 'text'}
                              value={formData[field.name] || ''}
                              onChange={(e) => setFormData({...formData, [field.name]: e.target.value})}
                              placeholder={field.placeholder}
                              className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm pr-10"
                           />
                           {field.type === 'password' && (
                               <button
                                 type="button"
                                 onClick={() => toggleFieldVisibility(field.name)}
                                 className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                               >
                                  {visibleFields.has(field.name) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                               </button>
                           )}
                       </div>
                   )}
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end gap-2 shrink-0">
          <button 
            onClick={onClose}
            className="px-4 py-2 border border-input rounded-md hover:bg-muted"
            disabled={saving}
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
          >
            {saving && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {initialData ? 'Update Credential' : 'Create Credential'}
          </button>
        </div>
      </div>
    </div>
  );
}
