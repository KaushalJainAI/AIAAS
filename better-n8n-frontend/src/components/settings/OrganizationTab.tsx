import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import orgsService, { type Org, type OrgRole } from '../../api/orgs';
import { useAuth } from '../../contexts/authState';

/**
 * Settings → Organisation: the people you share solved problems with.
 *
 * The active organisation is where new chats start; a chat keeps its org for
 * good, so switching here never moves an existing conversation. Nothing
 * captured in one organisation is ever offered in another.
 */
function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || fallback;
}

function Members({ org }: { org: Org }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const manager = org.role === 'owner' || org.role === 'admin';
  const { data: members = [], isLoading } = useQuery({
    queryKey: ['org-members', org.id],
    queryFn: () => orgsService.members(org.id),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['org-members', org.id] });
    void queryClient.invalidateQueries({ queryKey: ['orgs'] });
  };
  const add = useMutation({
    mutationFn: () => orgsService.addMember(org.id, email.trim()),
    onSuccess: () => { setEmail(''); refresh(); toast.success('Added.'); },
    onError: (e) => toast.error(errorText(e, 'Could not add them.')),
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
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); if (email.trim()) add.mutate(); }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
            className="flex-1 min-w-0 px-3 py-1.5 rounded border border-border bg-background text-sm"
          />
          <button
            type="submit"
            disabled={add.isPending || !email.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50"
          >
            <UserPlus className="w-3.5 h-3.5" /> Add
          </button>
        </form>
      )}
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
