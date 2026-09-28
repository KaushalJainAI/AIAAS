/**
 * Organisations — who shares solutions with whom (`core/orgs.py`).
 *
 * Every rule lives on the server: membership is checked live on each request,
 * and an org you are not in answers 404 exactly like one that does not exist.
 */
import apiClient from './client';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface Org {
  id: number;
  name: string;
  role: OrgRole;
  share_by_default: boolean;
}

export interface OrgMember {
  user_id: number;
  email: string;
  name: string;
  role: OrgRole;
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
  update: async (id: number, patch: { name?: string; share_by_default?: boolean }) =>
    (await apiClient.patch(`/orgs/${id}/`, patch)).data,
  remove: async (id: number) => {
    await apiClient.delete(`/orgs/${id}/`);
  },
  setActive: async (orgId: number | null) =>
    (await apiClient.post('/orgs/active/', { org_id: orgId })).data,
  members: async (id: number): Promise<OrgMember[]> => {
    const { data } = await apiClient.get(`/orgs/${id}/members/`);
    return Array.isArray(data?.members) ? data.members : [];
  },
  addMember: async (id: number, email: string, role: 'admin' | 'member' = 'member') =>
    (await apiClient.post(`/orgs/${id}/members/`, { email, role })).data,
  setRole: async (id: number, userId: number, role: OrgRole) =>
    (await apiClient.patch(`/orgs/${id}/members/${userId}/`, { role })).data,
  removeMember: async (id: number, userId: number) => {
    await apiClient.delete(`/orgs/${id}/members/${userId}/`);
  },
};

export default orgsService;
