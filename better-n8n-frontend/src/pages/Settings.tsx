import { useState, useEffect, useRef } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Settings as SettingsIcon,
  User,
  Bell,
  Brain,
  // Shield,  // MVP: unused while the Security tab is hidden
  Palette,
  Code,
  ChevronRight,
  Moon,
  Sun,
  Monitor,
  BarChart3,
  CreditCard,
  Zap,
  Check,
  Rocket,
  LogOut,
  RefreshCw,
  Loader2
} from 'lucide-react';
import { cn } from '../lib/utils';
import InsightsDashboard from '../components/billing/InsightsDashboard';
import SpendSummary from '../components/billing/SpendSummary';
import ChangeEmail from '../components/settings/ChangeEmail';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../contexts/authState';
import { authService } from '../api/auth';
import nodeService from '../api/nodeService';
import Select from '../components/ui/Select';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import NotificationsTab from '../components/settings/NotificationsTab';
import MemoryTab from '../components/settings/MemoryTab';
import { useAIModels } from '../hooks/useAIModels';
import {
  DEFAULT_EFFORT, EFFORT_LABELS, effortLevelsFor, nearestEffort,
} from '../hooks/useEffortSelection';
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from '../hooks/useChatModelSelection';
import { allZones, localZone } from '../lib/cron';
import SidebarMenuButton from '../components/layout/SidebarMenuButton';
import { toast } from 'sonner';

/** Languages the backend accepts (`core/preferences.py::LANGUAGES`), by code.
 *  The page used to store names ("English") while the column defaulted to a
 *  code ("en"), and the model path read neither. */
const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'de', label: 'German' },
  { value: 'fr', label: 'French' },
  { value: 'hi', label: 'Hindi' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
];

/** A stored value in either spelling, as the code the picker uses. */
function languageCode(stored: string | undefined): string {
  const text = (stored ?? '').trim().toLowerCase();
  const hit = LANGUAGE_OPTIONS.find(
    (o) => o.value === text || o.label.toLowerCase() === text,
  );
  return hit?.value ?? 'en';
}

type SettingsTab = 'general' | 'account' | 'notifications' | 'memory' | 'security' | 'appearance' | 'api' | 'insights' | 'billing';


/**
 * The settings form's shape. It was `any`, which meant a typo in a field name
 * — in the initial value, the `user` sync below, or a `name` attribute — was a
 * silent no-op rather than a compile error.
 */
interface SettingsForm {
  instance_name: string;
  timezone: string;
  language: string;
  display_name: string;
  bio: string;
  first_name: string;
  last_name: string;
  email: string;
  llm_provider: string;
  llm_model: string;
  llm_effort: string;
  default_temperature: number;
}

export default function Settings() {
  const [activeTab, setActiveTab] = usePersistedState<SettingsTab>('settings.tab', 'general');
  const [searchParams, setSearchParams] = useSearchParams();
  // `?tab=` deep-links a tab (the retired /insights route lands here).
  // Consumed on mount: an unknown value is ignored, and the param is
  // replaced away so a reload keeps the user's own last tab, not the link's.
  useEffect(() => {
    const asked = searchParams.get('tab');
    const visible: readonly string[] = ['general', 'account', 'insights', 'billing', 'notifications', 'memory', 'appearance', 'api'];
    if (asked && visible.includes(asked)) {
      setActiveTab(asked as SettingsTab);
      setSearchParams({}, { replace: true });
    }
    // Mount only: this honours the inbound link, not later tab switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [confirmRegenKey, setConfirmRegenKey] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { providers: catalogue, meta, refreshCatalog, refresh: refetchCatalogue } = useAIModels();
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Fallback editor state. The editor opens seeded from the server's current
  // pair; saving is staff-only on the backend, and a 403 says so plainly.
  const [fbEditing, setFbEditing] = useState(false);
  const [fbProvider, setFbProvider] = useState('');
  const [fbModel, setFbModel] = useState('');
  const [isSavingFallback, setIsSavingFallback] = useState(false);
  
  // Form State
  const [formData, setFormData] = useState<SettingsForm>({
    instance_name: '',
    timezone: 'UTC',
    language: 'English',
    display_name: '',
    bio: '',
    first_name: '',
    last_name: '',
    email: '',
    llm_provider: DEFAULT_PROVIDER,
    llm_model: DEFAULT_MODEL,
    llm_effort: DEFAULT_EFFORT,
    default_temperature: 0.7,
  });

  // The model list is read from the catalogue rather than written out here.
  // It used to be eight hardcoded options, and two of them — `gemini-3.6-flash`
  // and `gemini-3.1-pro-preview` — had since been retired in
  // `populate_models.py`, so this page offered models the picker in chat no
  // longer showed and the runtime would refuse. A second copy of a list the
  // server already publishes is a copy that drifts.
  const activeProvider = catalogue.find((p) => p.slug === formData.llm_provider);
  const effortLevels = effortLevelsFor(
    catalogue, formData.llm_provider, formData.llm_model,
  );
  // What the saved level would actually run at on the chosen model, by the same
  // rule the server applies. Shown rather than the raw stored value so the page
  // never displays a rung this model does not serve.
  const effectiveEffort = effortLevels.length
    ? nearestEffort(formData.llm_effort, effortLevels)
    : '';

  // Load the account into the form whenever the account object changes.
  // During render, not in an effect, so the form never paints blank first.
  const [seenUser, setSeenUser] = useState<typeof user | undefined>(undefined);
  const formFromUser = (u: NonNullable<typeof user>): SettingsForm => ({
        instance_name: u.instance_name || 'AIAAS Instance',
        timezone: u.timezone || 'UTC',
        language: languageCode(u.language),
        display_name: u.display_name || '',
        bio: u.bio || '',
        first_name: u.name?.split(' ')[0] || '',
        last_name: u.name?.split(' ').slice(1).join(' ') || '',
        email: u.email || '',
        llm_provider: u.llm_provider || DEFAULT_PROVIDER,
        llm_model: u.llm_model || DEFAULT_MODEL,
        // `??` not `||`: '' is a real choice here — the model's own default —
        // and `||` would silently promote it back to `medium` on every load.
        llm_effort: u.llm_effort ?? DEFAULT_EFFORT,
        // `??` for the same reason: 0 is a real temperature.
        default_temperature: u.default_temperature ?? 0.7,
  });
  if (user !== seenUser) {
    setSeenUser(user);
    if (user) setFormData(formFromUser(user));
  }
  // Settings still holds the untouched default while the browser knows where
  // the user is. Offered, never applied: the zone moves the chat clock and new
  // schedules, so it changes only when someone chooses it.
  const browserZone = localZone();
  const suggestZone = formData.timezone === 'UTC' && !!browserZone && browserZone !== 'UTC';

  const loadApiKey = async () => {
    try {
      const data = await authService.getApiKey();
      setApiKey(data.key);
    } catch (error) {
      console.error('Failed to load API key:', error);
    }
  };

  useEffect(() => {
    if (activeTab === 'api') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a server read; its state lands after the await
      void loadApiKey();
    }
  }, [activeTab]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  /** Live catalogue refresh: re-diffs OpenRouter against the held rows. */
  const handleRefreshCatalog = async () => {
    setIsRefreshing(true);
    try {
      const summary = await refreshCatalog();
      const retired = summary.retired.length;
      toast.success(
        `Model catalog refreshed: ${summary.added} new, ${summary.updated} updated, ${retired} retired` +
        (summary.affected_agents.length
          ? ` — ${summary.affected_agents.length} agent(s) moved to the fallback and their owners were notified`
          : ''),
      );
    } catch (error) {
      const status = (error as { response?: { status?: number; data?: { detail?: string } } })?.response?.status;
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(
        status === 403
          ? 'Refreshing the catalog is staff-only'
          : status === 409
            ? 'A refresh is already running — try again in a minute'
            : detail || 'Could not refresh the catalog',
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  /** Save the platform fallback model (staff-only on the backend). */
  const handleSaveFallback = async () => {
    setIsSavingFallback(true);
    try {
      const saved = await nodeService.updateFallback(fbProvider, fbModel);
      setFbEditing(false);
      await refetchCatalogue();
      toast.success(`Fallback model is now ${saved.provider}/${saved.model}`);
      if (saved.warning) toast.error(saved.warning);
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(
        status === 403 ? 'Changing the fallback model is staff-only' : detail || 'Could not save the fallback',
      );
    } finally {
      setIsSavingFallback(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Prepare data for backend
      const patchData = {
        ...formData,
        user: {
          first_name: formData.first_name,
          last_name: formData.last_name,
          email: formData.email,
        },
        theme_preference: theme,
        accent_color: colorTheme,
      };

      await authService.updateProfile(patchData);
      await refreshUser();
      toast.success('Settings saved');
    } catch (error) {
      console.error('Failed to save settings:', error);
      const data = (error as { response?: { data?: Record<string, unknown> } }).response?.data;
      const first = data && Object.entries(data)[0];
      toast.error(first
        ? `${first[0]}: ${String(Array.isArray(first[1]) ? first[1][0] : first[1])}`
        : 'Could not save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRegenerateKey = async () => {
    try {
      const data = await authService.regenerateApiKey();
      setApiKey(data.key);
    } catch (error) {
      console.error('Failed to regenerate API key:', error);
    } finally {
      setConfirmRegenKey(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Helper to get initials from name
  const getInitials = () => {
    if (user?.name) {
      const parts = user.name.split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return user.name.slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return '??';
  };
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await authService.uploadAvatar(file);
      await refreshUser();
    } catch (error) {
      console.error('Failed to upload avatar:', error);
      toast.error('Could not upload that image');
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const tabs = [
    { id: 'general' as const, label: 'General', icon: SettingsIcon },
    { id: 'account' as const, label: 'Account', icon: User },
    { id: 'insights' as const, label: 'Insights', icon: BarChart3 },
    { id: 'billing' as const, label: 'Billing', icon: CreditCard },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'memory' as const, label: 'Memory', icon: Brain },
    // MVP: Security is the only tab with no `case` in renderContent(), so it
    // fell through to the "coming soon" default. Hidden rather than built out.
    // The 'security' member stays on SettingsTab and the default branch stays
    // below, so a persisted `settings.tab` of 'security' still lands somewhere
    // instead of crashing.
    // { id: 'security' as const, label: 'Security', icon: Shield },
    { id: 'appearance' as const, label: 'Appearance', icon: Palette },
    { id: 'api' as const, label: 'API', icon: Code },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-4">General settings</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium">Instance name</p>
                    <p className="text-sm text-muted-foreground">Personalize your platform title</p>
                  </div>
                  <input 
                    type="text" 
                    name="instance_name"
                    value={formData.instance_name}
                    onChange={handleInputChange}
                    className="px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200"
                  />
                </div>
                
                {/* Provider, model and effort — the same three choices the
                    chat composer and the agent builder offer, driven by the
                    same catalogue so none of them can drift from the others. */}
                <div className="p-4 bg-muted/50 rounded-lg border border-primary/10 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium flex items-center gap-2">
                        Default AI provider
                        <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
                      </p>
                      <p className="text-sm text-muted-foreground">Who serves your AI features</p>
                    </div>
                    <Select
                      value={formData.llm_provider}
                      onChange={(val) => {
                        // Changing provider invalidates the model, so both move
                        // together. Leaving the old id in place would save a
                        // pair the runtime cannot route.
                        const first = catalogue.find((p) => p.slug === val)?.models?.[0]?.value ?? '';
                        setFormData((prev) => ({ ...prev, llm_provider: val, llm_model: first }));
                      }}
                      options={catalogue.map((p) => ({ value: p.slug, label: p.name }))}
                      placeholder="Choose a provider"
                      className="w-[250px]"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">Default AI model</p>
                      <p className="text-sm text-muted-foreground">The primary model for AI features</p>
                    </div>
                    <Select
                      value={formData.llm_model}
                      onChange={(val) => handleSelectChange('llm_model', val)}
                      showSearch={(activeProvider?.models?.length ?? 0) > 8}
                      options={(activeProvider?.models ?? []).map((mo) => ({
                        value: mo.value,
                        label: mo.is_free ? `${mo.name} · free` : mo.name,
                        is_free: mo.is_free,
                      }))}
                      placeholder="Choose a model"
                      className="w-[250px]"
                    />
                  </div>

                  {/* Always rendered, including for a model with no effort
                      control — see `EffortPicker` for why. An empty space
                      cannot say "this model does not support it". */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">Reasoning effort</p>
                      <p className="text-sm text-muted-foreground">
                        How hard it thinks before answering
                      </p>
                    </div>
                    {effortLevels.length > 0 ? (
                      <Select
                        value={effectiveEffort}
                        onChange={(val) => handleSelectChange('llm_effort', val)}
                        options={[
                          { value: '', label: EFFORT_LABELS[''] },
                          ...effortLevels.map((level) => ({
                            value: level,
                            label: EFFORT_LABELS[level] ?? level,
                          })),
                        ]}
                        className="w-[250px]"
                      />
                    ) : (
                      <p className="w-[250px] text-sm text-muted-foreground/60 text-right">
                        Not supported by this model
                      </p>
                    )}
                  </div>

                  {/* Catalogue refresh + fallback. The catalogue is global
                      state every picker reads, so the refresh lives next to
                      the pickers it serves rather than on a page of its own.
                      The fallback is what runs execute on when their
                      configured model is retired or unknown. */}
                  <div className="flex items-center justify-between gap-4 pt-3 border-t border-border/50">
                    <div>
                      <p className="font-medium">Model catalogue</p>
                      <p className="text-sm text-muted-foreground">
                        {meta?.last_refresh
                          ? `Last refreshed ${new Date(meta.last_refresh.at).toLocaleString()}`
                          : 'Never refreshed from live'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRefreshCatalog()}
                      disabled={isRefreshing}
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline disabled:opacity-50"
                    >
                      {isRefreshing
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />}
                      {isRefreshing ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </div>

                  {fbEditing ? (
                    <div className="pt-3 border-t border-border/50 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-medium">Fallback provider</p>
                          <p className="text-sm text-muted-foreground">Who serves the fallback</p>
                        </div>
                        <Select
                          value={fbProvider}
                          onChange={(val) => {
                            const first = catalogue.find((p) => p.slug === val)?.models?.[0]?.value ?? '';
                            setFbProvider(val);
                            setFbModel(first);
                          }}
                          options={catalogue.map((p) => ({ value: p.slug, label: p.name }))}
                          placeholder="Choose a provider"
                          className="w-[250px]"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-medium">Fallback model</p>
                          <p className="text-sm text-muted-foreground">Runs on retired models execute here</p>
                        </div>
                        <Select
                          value={fbModel}
                          onChange={setFbModel}
                          showSearch={(catalogue.find((p) => p.slug === fbProvider)?.models?.length ?? 0) > 8}
                          options={(catalogue.find((p) => p.slug === fbProvider)?.models ?? []).map((mo) => ({
                            value: mo.value,
                            label: mo.is_free ? `${mo.name} · free` : mo.name,
                          }))}
                          placeholder="Choose a model"
                          className="w-[250px]"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setFbEditing(false)}
                          className="text-sm text-muted-foreground hover:underline"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveFallback()}
                          disabled={!fbModel || isSavingFallback}
                          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline disabled:opacity-50"
                        >
                          {isSavingFallback ? 'Saving…' : 'Save fallback'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">Fallback model</p>
                        <p className="text-sm text-muted-foreground">
                          Runs on a retired or unknown model execute here instead — the stored
                          configuration is left untouched and the owner is notified
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">
                          {meta?.fallback ? `${meta.fallback.provider}/${meta.fallback.model}` : '…'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setFbProvider(meta?.fallback?.provider ?? formData.llm_provider);
                            setFbModel(meta?.fallback?.model ?? formData.llm_model);
                            setFbEditing(true);
                          }}
                          className="text-sm text-primary hover:underline"
                        >
                          Change
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium">Timezone</p>
                    <p className="text-sm text-muted-foreground">
                      The assistant's clock, and the default for new schedules
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {/* Every zone the browser knows. It was five, so most of
                        the world could not pick their own. */}
                    <Select
                      value={formData.timezone}
                      onChange={(val) => handleSelectChange('timezone', val)}
                      showSearch
                      options={allZones().map((z) => ({ value: z, label: z }))}
                      className="w-[240px]"
                    />
                    {suggestZone && (
                      <button type="button"
                        onClick={() => handleSelectChange('timezone', browserZone)}
                        className="text-[12px] text-primary hover:underline">
                        Use {browserZone} (this device)
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium">Language</p>
                    <p className="text-sm text-muted-foreground">
                      What the assistant and your agents reply in
                    </p>
                  </div>
                  <Select
                    value={formData.language}
                    onChange={(val) => handleSelectChange('language', val)}
                    options={LANGUAGE_OPTIONS}
                    className="w-[200px]"
                  />
                </div>
                {/* Stored since the profile existed and read by nothing. It is
                    now what a new agent starts at in the builder. */}
                <div className="flex items-center justify-between gap-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium">Default temperature for new agents</p>
                    <p className="text-sm text-muted-foreground">
                      Low is exact and repeatable; high is more varied. Each agent can override it.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 w-[200px]">
                    <input type="range" min={0} max={2} step={0.1}
                      value={formData.default_temperature}
                      onChange={(e) => setFormData((prev) => ({
                        ...prev, default_temperature: Number(e.target.value),
                      }))}
                      aria-label="Default temperature for new agents"
                      className="flex-1 accent-primary" />
                    <span className="w-8 text-right text-sm tabular-nums">
                      {formData.default_temperature.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'account':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-4">Account settings</h3>
              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg mb-4">
                <div 
                  onClick={handleAvatarClick}
                  className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-xl font-bold text-primary ring-4 ring-primary/5 overflow-hidden cursor-pointer group relative"
                >
                  {user?.avatar ? (
                    <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    getInitials()
                  )}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <User className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div>
                  <p className="font-medium">{user?.name || 'User'}</p>
                  <p className="text-sm text-muted-foreground">{user?.email || ''}</p>
                </div>
                <button 
                  onClick={handleAvatarClick}
                  className="ml-auto px-4 py-2 border border-border/60 rounded-lg hover:bg-muted transition-colors"
                >
                  Change Avatar
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*"
                  onChange={handleFileChange}
                />
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">First name</label>
                    <input 
                      type="text" 
                      name="first_name"
                      value={formData.first_name}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Last name</label>
                    <input 
                      type="text" 
                      name="last_name"
                      value={formData.last_name}
                      onChange={handleInputChange}
                      className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200"
                    />
                  </div>
                </div>
                {/* Stored on the profile and never editable. The assistant and
                    agents now address the user by it. */}
                <div>
                  <label className="block text-sm font-medium mb-2">What should the assistant call you?</label>
                  <input
                    type="text"
                    name="display_name"
                    value={formData.display_name}
                    onChange={handleInputChange}
                    maxLength={80}
                    placeholder={formData.first_name || 'Your name'}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200"
                  />
                </div>
                <ChangeEmail current={user?.email ?? ''} onChanged={refreshUser} />
                <div>
                  <label className="block text-sm font-medium mb-2">Bio</label>
                  <textarea 
                    name="bio"
                    value={formData.bio}
                    onChange={handleInputChange}
                    rows={3}
                    className="w-full px-3 py-2 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 resize-none"
                    placeholder="e.g. Backend engineer in Bengaluru. I prefer code first, then the explanation."
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The assistant and your agents read this, so say what helps them help you.
                  </p>
                </div>
              </div>

              <div className="mt-10 pt-6 border-t border-border/60">
                <h4 className="text-sm font-semibold mb-2">Session</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Log out of your account on this device.
                </p>
                <button 
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors duration-200 rounded-lg font-medium border border-border/60"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        );

      case 'appearance':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-4">Appearance</h3>
              <div className="space-y-4">
                <div>
                  <p className="font-medium mb-3">Theme</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'light' as const, label: 'Light', icon: Sun },
                      { id: 'dark' as const, label: 'Dark', icon: Moon },
                      { id: 'system' as const, label: 'System', icon: Monitor },
                    ].map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        onClick={() => setTheme(id)}
                        className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors duration-200 ${
                          theme === id 
                            ? 'border-primary bg-primary/5 shadow-sm' 
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <Icon className="w-6 h-6" />
                        <span className="text-sm font-medium">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="font-medium mb-3 text-foreground/90">Accent palette</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: 'blue' as const, label: 'Communication blue', color: 'bg-primary' },
                      { id: 'magenta' as const, label: 'Agent violet', color: 'bg-agent' },
                    ].map(({ id, label, color }) => (
                      <button
                        key={id}
                        onClick={() => setColorTheme(id)}
                        className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-colors duration-300 relative overflow-hidden group/palette ${
                          colorTheme === id 
                            ? 'border-primary bg-primary/5 shadow-sm' 
                            : 'border-border hover:border-primary/40 hover:bg-muted/30'
                        }`}
                      >
                        <div className={cn("w-5 h-5 rounded-full ring-2 ring-primary/20", color)} />
                        <span className="text-sm font-semibold">{label}</span>
                        {colorTheme === id && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'api':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-4">API settings</h3>
              <div className="space-y-4">
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium">API key</p>
                    <button 
                      onClick={() => setConfirmRegenKey(true)}
                      className="text-sm text-primary hover:underline"
                    >
                      Regenerate
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 p-2 bg-background border border-input rounded-lg text-sm font-mono overflow-hidden text-ellipsis">
                      {apiKey || '••••••••••••••••••••••••••••••••'}
                    </code>
                    {/* Only a freshly generated key is whole; a stored one is
                        its masked prefix, which is not worth copying. */}
                    {apiKey && !apiKey.endsWith('…') && (
                      <button
                        onClick={() => copyToClipboard(apiKey)}
                        className="px-3 py-2 border border-border/60 rounded-lg hover:bg-muted text-sm whitespace-nowrap transition-colors"
                      >
                        {isCopied ? 'Copied!' : 'Copy'}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Keep this key secret. It allows full access to your account.
                    The full key is shown only right after you generate it — copy it then.
                  </p>
                </div>
                {/* This showed `/api/webhook/`, a route that does not exist: the
                    account-wide receiver went with the workflow product. Each
                    agent's webhook has its own secret URL, made on Schedules. */}
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="font-medium mb-1">Webhooks</p>
                  <p className="text-sm text-muted-foreground">
                    Each agent gets its own webhook URL with a secret in it. Create one
                    on the <Link to="/schedules" className="text-primary hover:underline">Schedules</Link> page.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      case 'insights':
        return (
          <div className="space-y-6">
            <div className="mb-6">
              <h3 className="text-lg font-medium">Insights</h3>
              <p className="text-sm text-muted-foreground mt-1">Analyze your workflow performance and ROI</p>
            </div>
            <InsightsDashboard />
          </div>
        );

      case 'billing':
        // Early access has no paid plans. This tab used to render three price
        // cards with "Upgrade" buttons wired to nothing and limits written for
        // the retired workflow product; a screen promising a purchase that
        // cannot happen is worse than one saying plainly that there is none.
        return (
          <div className="space-y-8 max-w-3xl">
            <div>
              <h3 className="text-2xl font-bold tracking-tight">Usage</h3>
              <p className="text-muted-foreground mt-1">
                Early access is free. Each account has a credit allowance so one runaway agent cannot spend it all.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 rounded-lg border border-border bg-card">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 bg-success-subtle rounded-lg border border-border">
                    <CreditCard className="w-5 h-5 text-success" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Credits remaining</p>
                    <h3 className="text-2xl font-bold">{(user?.credits ?? 0).toLocaleString()}</h3>
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  One credit covers roughly 1,000 tokens of model usage on the platform key.
                </p>
              </div>

              <div className="p-6 rounded-lg border border-border bg-card">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 bg-agent-subtle rounded-lg border border-agent-line">
                    <Rocket className="w-5 h-5 text-agent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Plan</p>
                    <h3 className="text-2xl font-bold capitalize">{user?.tier || 'Free'}</h3>
                  </div>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  Free models and calls made with your own provider keys never use credits.
                </p>
              </div>
              <SpendSummary />
            </div>
          </div>
        );

      case 'notifications':
        return <NotificationsTab />;
      case 'memory':
        return <MemoryTab />;

      default:
        return (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <p>Choose a section on the left.</p>
          </div>
        );
    }
  };

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* Settings Sidebar — menu button is in-flow at the rail start on
          phones, same 40px slot as every title bar. */}
      <div className="w-full md:w-64 border-b md:border-r md:border-b-0 border-border bg-card p-2 md:p-4 shrink-0 overflow-x-auto scrollbar-none">
        <h2 className="text-lg font-semibold mb-2 md:mb-4 px-2 hidden md:block">Settings</h2>
        <div className="flex items-center gap-1 min-h-10">
          <SidebarMenuButton className="md:hidden self-center" />
          <nav className="flex flex-row md:flex-col space-x-2 md:space-x-0 md:space-y-1 min-w-max md:min-w-0 pb-1 md:pb-0 flex-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:py-2.5 rounded-lg transition-colors duration-200 relative whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {activeTab === tab.id && (
                <div className="hidden md:block absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full" />
              )}
              {activeTab === tab.id && (
                <div className="md:hidden absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-5 bg-primary rounded-t-full" />
              )}
              <tab.icon className="w-4 h-4 shrink-0" />
              <span className="md:flex-1 text-left text-sm md:text-base">{tab.label}</span>
              <ChevronRight className={`hidden md:block w-4 h-4 transition-transform ${
                activeTab === tab.id ? 'rotate-90' : ''
              }`} />
            </button>
          ))}
          </nav>
        </div>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className={cn(
          "w-full",
          !['insights', 'billing'].includes(activeTab) && "max-w-3xl"
        )}>
          {renderContent()}
          
          {['general', 'account', 'appearance'].includes(activeTab) && (
            <div className="mt-8 pt-6 border-t border-border flex justify-end gap-2">
              {/* Was a Cancel button with no handler. */}
              <button
                onClick={() => { if (user) setFormData(formFromUser(user)); }}
                className="px-4 py-2 border border-border rounded-lg hover:bg-secondary transition-colors">
                Discard changes
              </button>
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors shadow-sm font-medium disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </div>
      {confirmRegenKey && (
        <ConfirmDialog
          title="Regenerate API key?"
          body="This invalidates your old key immediately. Update anywhere it is used."
          confirmLabel="Regenerate"
          onCancel={() => setConfirmRegenKey(false)}
          onConfirm={handleRegenerateKey}
        />
      )}
    </div>
  );
}
