/**
 * Organisations — who shares solutions with whom (`core/orgs.py`).
 *
 * Every rule lives on the server: membership is checked live on each request,
 * and an org you are not in answers 404 exactly like one that does not exist.
 *
 * Nobody joins by being added. A manager sends an invitation; the person
 * accepts it from their own verified account (`myInvites` / `respondInvite`).
 */
import apiClient from './client';

/** `curator` approves and edits team solutions; it cannot manage people. */
export type OrgRole = 'owner' | 'admin' | 'curator' | 'member';

/** Roles that may change the organisation's settings and its people. */
export const MANAGER_ROLES: OrgRole[] = ['owner', 'admin'];

/** Roles that may see and act on the review queue (`core/orgs.py::CURATORS`). */
export const CURATOR_ROLES: OrgRole[] = ['owner', 'admin', 'curator'];

/** `suggest`: a fix found in chat is offered to its author as a draft. `auto`: saved at once. */
export type CaptureMode = 'suggest' | 'auto';

/** `open`: a share reaches the team at once. `curated`: a curator approves each one. */
export type ReviewPolicy = 'open' | 'curated';

export interface Org {
  id: number;
  name: string;
  role: OrgRole;
  share_by_default: boolean;
  capture_mode: CaptureMode;
  review_policy: ReviewPolicy;
}

export interface OrgMember {
  user_id: number;
  email: string;
  name: string;
  role: OrgRole;
}

/** An open invitation as the manager of its org sees it. */
export interface OrgInvite {
  id: number;
  email: string;
  role: OrgRole;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
}

/** An invitation addressed to the signed-in account. */
export interface MyInvite {
  id: number;
  org_id: number;
  org_name: string;
  role: OrgRole;
  invited_by_name: string | null;
  expires_at: string;
  /** False until the account's email is verified; declining still works. */
  can_accept: boolean;
}

export interface InviteList<T> {
  invites: T[];
  /** True when the server cut the list at its cap. */
  truncated: boolean;
}

const orgsService = {
  list: async (): Promise<{ orgs: Org[]; active_org_id: number | null }> => {
    const { data } = await apiClient.get('/orgs/');
    return {
      orgs: Array.isArray(data?.orgs) ? data.orgs : [],
      active_org_id: data?.active_org_id ?? null,
    };
  },
  create: async (name: string): Promise<Org> => (await apiClient.post('/orgs/', { name })).data,
  update: async (
    id: number,
    patch: {
      name?: string;
      share_by_default?: boolean;
      capture_mode?: CaptureMode;
      review_policy?: ReviewPolicy;
    },
  ) => (await apiClient.patch(`/orgs/${id}/`, patch)).data,
  remove: async (id: number) => {
    await apiClient.delete(`/orgs/${id}/`);
  },
  setActive: async (orgId: number | null) =>
    (await apiClient.post('/orgs/active/', { org_id: orgId })).data,
  members: async (id: number): Promise<OrgMember[]> => {
    const { data } = await apiClient.get(`/orgs/${id}/members/`);
    return Array.isArray(data?.members) ? data.members : [];
  },
  /** Sends an invitation. Answers the same whether or not the address has an account. */
  invite: async (id: number, email: string, role: Exclude<OrgRole, 'owner'> = 'member') =>
    (await apiClient.post(`/orgs/${id}/members/`, { email, role })).data as {
      invited: string;
      expires_at: string;
    },
  /** Pending invitations of one org (managers only). */
  listInvites: async (id: number): Promise<InviteList<OrgInvite>> => {
    const { data } = await apiClient.get(`/orgs/${id}/invites/`);
    return {
      invites: Array.isArray(data?.invites) ? data.invites : [],
      truncated: data?.truncated === true,
    };
  },
  revokeInvite: async (id: number, inviteId: number) => {
    await apiClient.delete(`/orgs/${id}/invites/${inviteId}/`);
  },
  /** Invitations addressed to the signed-in account. */
  myInvites: async (): Promise<InviteList<MyInvite>> => {
    const { data } = await apiClient.get('/orgs/invites/');
    return {
      invites: Array.isArray(data?.invites) ? data.invites : [],
      truncated: data?.truncated === true,
    };
  },
  /** Accept (200 `{org_id, role}`) or decline (204, no body) an invitation. */
  respondInvite: async (inviteId: number, accept: boolean) =>
    (await apiClient.post(`/orgs/invites/${inviteId}/`, { accept })).data as
      | { org_id: number; role: OrgRole }
      | '',
  setRole: async (id: number, userId: number, role: OrgRole) =>
    (await apiClient.patch(`/orgs/${id}/members/${userId}/`, { role })).data,
  removeMember: async (id: number, userId: number) => {
    await apiClient.delete(`/orgs/${id}/members/${userId}/`);
  },
};

export default orgsService;
