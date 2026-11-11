import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Loader2, Mail, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import orgsService, {
  MANAGER_ROLES,
  type CaptureMode,
  type MyInvite,
  type Org,
  type OrgRole,
  type ReviewPolicy,
} from '../../api/orgs';
import { useAuth } from '../../contexts/authState';

/** What a curator can and cannot do, shown wherever the role is picked (K2.8). */
const CURATOR_HELP ='Approves and edits team solutions; cannot manage people.';

type InviteRole = Exclude<OrgRole, 'owner'>;

/**
 * Settings → Organisation: the people you share solved problems with.
 *
 * The active organisation is where new chats start; a chat keeps its org for
 * good, so switching here never moves an existing conversation. Nothing
 * captured in one organisation is ever offered in another.
 *
 * Nobody joins by being added: a manager sends an invitation, and the person
 * accepts it from the card at the top of this tab.
 */
function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || fallback;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function Invitations({ org }: { org: Org }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['org-invites', org.id],
    queryFn: () => orgsService.listInvites(org.id),
  });
  const revoke = useMutation({
    mutationFn: (inviteId: number) => orgsService.revokeInvite(org.id, inviteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-invites', org.id] });
      toast.success('Invitation withdrawn.');
    },
    onError: (e) => toast.error(errorText(e, 'Could not withdraw it.')),
  });

  const invites = data?.invites ?? [];
  if (isLoading) return null;
  if (invites.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-[12px] font-medium text-muted-foreground">Pending invitations</p>
      <ul className="mt-2 divide-y divide-border/60 border border-border/60 rounded-lg bg-card/60">
        {invites.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <div className="flex-1 min-w-0">
              <p className="truncate">{i.email}</p>
              <p className="text-[12px] text-muted-foreground truncate">
                {i.role} · expires {formatDate(i.expires_at)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => revoke.mutate(i.id)}
              disabled={revoke.isPending}
              className="text-[12px] text-muted-foreground underline disabled:opacity-50"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {data?.truncated && (
        <p className="mt-1 text-[12px] text-muted-foreground">Showing the first 200.</p>
      )}
    </div>
  );
}

function Members({ org }: { org: Org }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('member');
  const manager = MANAGER_ROLES.includes(org.role);
  const { data: members = [], isLoading } = useQuery({
    queryKey: ['org-members', org.id],
    queryFn: () => orgsService.members(org.id),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['org-members', org.id] });
    void queryClient.invalidateQueries({ queryKey: ['org-invites', org.id] });
    void queryClient.invalidateQueries({ queryKey: ['orgs'] });
  };
  const invite = useMutation({
    mutationFn: () => orgsService.invite(org.id, email.trim(), inviteRole),
    onSuccess: () => { setEmail(''); refresh(); toast.success('Invitation sent'); },
    onError: (e) => toast.error(errorText(e, 'Could not send the invitation.')),
  });
  const remove = useMutation({
    mutationFn: (userId: number) => orgsService.removeMember(org.id, userId),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e, 'Could not remove them.')),
  });
  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: OrgRole }) =>
      orgsService.setRole(org.id, userId, role),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e, 'Could not change their role.')),
  });

  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-3" />;
  return (
    <div className="mt-3 space-y-2">
      <ul className="divide-y divide-border/60 border border-border/60 rounded-lg bg-card/60">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <div className="flex-1 min-w-0">
              <p className="truncate">{m.name}</p>
              <p className="text-[12px] text-muted-foreground truncate">{m.email}</p>
            </div>
            {manager && m.role !== 'owner' ? (
              <select
                value={m.role}
                disabled={changeRole.isPending}
                onChange={(e) => changeRole.mutate({ userId: m.user_id, role: e.target.value as OrgRole })}
                aria-label={`Role for ${m.email}`}
                className="px-1.5 py-1 rounded border border-border bg-background text-[12px] capitalize"
              >
                <option value="admin">Admin</option>
                <option value="curator">Curator</option>
                <option value="member">Member</option>
              </select>
            ) : (
              <span className="text-[12px] text-muted-foreground capitalize">{m.role}</span>
            )}
            {manager && m.role !== 'owner' && (
              <button
                type="button"
                onClick={() => remove.mutate(m.user_id)}
                aria-label={`Remove ${m.email}`}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {manager && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">Curator:</span> {CURATOR_HELP}
          </p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => { e.preventDefault(); if (email.trim()) invite.mutate(); }}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              aria-label="Email to invite"
              className="flex-1 min-w-[12rem] px-3 py-1.5 rounded border border-border bg-background text-sm"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as InviteRole)}
              aria-label="Role for the invitation"
              className="px-2 py-1.5 rounded border border-border bg-background text-sm"
            >
              <option value="member">Member</option>
              <option value="curator">Curator</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              disabled={invite.isPending || !email.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50"
            >
              <UserPlus className="w-3.5 h-3.5" /> Invite
            </button>
          </form>
        </div>
      )}
      {manager && <Invitations org={org} />}
    </div>
  );
}

/** Invitations addressed to the signed-in account, shown above the organisations. */
function MyInvitations() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['org-invites-mine'],
    queryFn: orgsService.myInvites,
  });
  const answer = useMutation({
    mutationFn: ({ invite, accept }: { invite: MyInvite; accept: boolean }) =>
      orgsService.respondInvite(invite.id, accept),
    onSuccess: (_result, { invite, accept }) => {
      void queryClient.invalidateQueries({ queryKey: ['org-invites-mine'] });
      void queryClient.invalidateQueries({ queryKey: ['orgs'] });
      toast.success(accept ? `You joined ${invite.org_name}.` : 'Invitation declined.');
    },
    onError: (e) => {
      void queryClient.invalidateQueries({ queryKey: ['org-invites-mine'] });
      toast.error(errorText(e, 'Could not answer the invitation.'));
    },
  });

  const invites = data?.invites ?? [];
  if (invites.length === 0) return null;
  return (
    <div className="mt-6 space-y-3">
      {invites.map((invite) => (
        <div
          key={invite.id}
          className="flex flex-wrap items-center gap-3 p-4 rounded-lg border border-primary/40 bg-card"
        >
          <Mail className="w-4 h-4 text-muted-foreground" />
          <div className="flex-1 min-w-[200px] text-sm">
            <p>
              {invite.invited_by_name ?? 'Someone'} invited you to {invite.org_name} as{' '}
              <span className="capitalize">{invite.role}</span>.
            </p>
            {!invite.can_accept && (
              <p className="text-[12px] text-muted-foreground mt-1">
                Verify your email address to accept. Forgot password, or signing in
                with Google, proves it.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={answer.isPending || !invite.can_accept}
            onClick={() => answer.mutate({ invite, accept: true })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" /> Accept
          </button>
          <button
            type="button"
            disabled={answer.isPending}
            onClick={() => answer.mutate({ invite, accept: false })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-[12px] disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" /> Decline
          </button>
        </div>
      ))}
    </div>
  );
}

const CAPTURE_OPTIONS: { value: CaptureMode; label: string; help: string }[] = [
  {
    value: 'suggest',
    label: 'Suggest it to the author (recommended)',
    help: 'It is kept as a draft that only its author can see, and they choose whether to share it.',
  },
  {
    value: 'auto',
    label: 'Save automatically',
    help: 'It is saved at once. It is shared only if its author asked for that in the chat.',
  },
];

const REVIEW_OPTIONS: { value: ReviewPolicy; label: string; help: string }[] = [
  { value: 'open', label: 'Anyone, at once', help: 'A shared solution reaches the team straight away.' },
  {
    value: 'curated',
    label: 'A curator approves each one',
    help: 'A shared solution waits in the review queue until a curator approves it.',
  },
];

/** Two choices a manager makes for the whole organisation (K2.8). */
function OrgPolicies({ org }: { org: Org }) {
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (patch: { capture_mode?: CaptureMode; review_policy?: ReviewPolicy }) =>
      orgsService.update(org.id, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['orgs'] }),
    onError: (e) => toast.error(errorText(e, 'Only an owner or admin can change this.')),
  });

  return (
    <div className="mt-4 space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">When a fix is found in chat</legend>
        {CAPTURE_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`capture-mode-${org.id}`}
              value={opt.value}
              checked={org.capture_mode === opt.value}
              disabled={update.isPending}
              onChange={() => update.mutate({ capture_mode: opt.value })}
              className="mt-1"
            />
            <span>
              {opt.label}
              <span className="block text-[12px] text-muted-foreground">{opt.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who can share with the whole team</legend>
        {REVIEW_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`review-policy-${org.id}`}
              value={opt.value}
              checked={org.review_policy === opt.value}
              disabled={update.isPending}
              onChange={() => update.mutate({ review_policy: opt.value })}
              className="mt-1"
            />
            <span>
              {opt.label}
              <span className="block text-[12px] text-muted-foreground">{opt.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export default function OrganizationTab() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['orgs'], queryFn: orgsService.list });
  const orgs = data?.orgs ?? [];
  const active = data?.active_org_id ?? null;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['orgs'] });

  const create = useMutation({
    mutationFn: () => orgsService.create(name.trim()),
    onSuccess: () => { setName(''); refresh(); toast.success('Organisation created.'); },
    onError: (e) => toast.error(errorText(e, 'Could not create it.')),
  });
  const setActive = useMutation({
    mutationFn: (id: number | null) => orgsService.setActive(id),
    onSuccess: refresh,
  });
  const setDefault = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) =>
      orgsService.update(id, { share_by_default: value }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e, 'Only an owner or admin can change this.')),
  });
  const leave = useMutation({
    mutationFn: ({ org, userId }: { org: Org; userId: number }) => orgsService.removeMember(org.id, userId),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e, 'Could not leave.')),
  });

  if (isLoading) {
    return <div className="h-16 rounded-lg bg-card border border-border/60 animate-pulse" />;
  }

  return (
    <div>
      <h3 className="text-lg font-medium">Organisation</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-xl">
        People in the same organisation can find the problems each other has
        solved. New chats start in your active organisation; each chat has its
        own switch for whether its solutions are shared. Nothing from one
        organisation is ever shown in another.
      </p>

      <MyInvitations />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor="active-org">New chats start in</label>
        <select
          id="active-org"
          value={active ?? ''}
          onChange={(e) => setActive.mutate(e.target.value ? Number(e.target.value) : null)}
          className="px-2 py-1.5 rounded border border-border bg-background text-sm"
        >
          <option value="">Just me (no organisation)</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      <div className="mt-6 space-y-6">
        {orgs.map((org) => (
          <section key={org.id} className="p-4 rounded-lg border border-border/60 bg-card/40">
            <div className="flex flex-wrap items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <h4 className="font-medium">{org.name}</h4>
              <span className="text-[12px] text-muted-foreground capitalize">· {org.role}</span>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={org.share_by_default}
                disabled={org.role === 'member'}
                onChange={(e) => setDefault.mutate({ id: org.id, value: e.target.checked })}
              />
              New chats share their solutions with the organisation by default
            </label>
            {MANAGER_ROLES.includes(org.role) && <OrgPolicies org={org} />}
            <Members org={org} />
            {org.role !== 'owner' && (
              <button
                type="button"
                onClick={() => { if (user) leave.mutate({ org, userId: user.id }); }}
                className="mt-3 text-[12px] text-muted-foreground underline"
              >
                Leave {org.name}
              </button>
            )}
          </section>
        ))}
      </div>

      <form
        className="mt-6 flex gap-2 max-w-md"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New organisation name"
          className="flex-1 min-w-0 px-3 py-1.5 rounded border border-border bg-background text-sm"
        />
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50"
        >
          Create
        </button>
      </form>
    </div>
  );
}
