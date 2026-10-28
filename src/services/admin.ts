import { api } from '@/api/client';

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  roleId: number;
  roleName: string;
  disabled: boolean;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface AdminRole {
  id: number;
  name: string;
  description: string;
  permissions: string[];
  builtin: boolean;
  userCount: number;
}

export const listUsers = () => api<{ users: AdminUser[] }>('/api/admin/users').then((r) => r.users);
export const createUser = (body: { username: string; displayName: string; password: string; roleId: number }) =>
  api<{ id: number }>('/api/admin/users', { method: 'POST', body });
export const updateUser = (id: number, body: Partial<Pick<AdminUser, 'displayName' | 'roleId' | 'disabled'>>) =>
  api(`/api/admin/users/${id}`, { method: 'PATCH', body });
export const resetUserPassword = (id: number, password: string) =>
  api(`/api/admin/users/${id}/password`, { method: 'POST', body: { password } });
export const deleteUser = (id: number) => api(`/api/admin/users/${id}`, { method: 'DELETE' });

export const listRoles = () => api<{ roles: AdminRole[] }>('/api/admin/roles').then((r) => r.roles);
export const createRole = (body: { name: string; description: string; permissions: string[] }) =>
  api<{ id: number }>('/api/admin/roles', { method: 'POST', body });
export const updateRole = (id: number, body: { name?: string; description?: string; permissions?: string[] }) =>
  api(`/api/admin/roles/${id}`, { method: 'PATCH', body });
export const deleteRole = (id: number) => api(`/api/admin/roles/${id}`, { method: 'DELETE' });
