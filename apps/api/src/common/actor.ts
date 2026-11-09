export interface Actor {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  locale: string;
  theme: string;
  accent: string | null;
  roles: string[];
  permissions: string[];
  customFields: unknown;
}

export function hasPermission(actor: Actor, permission: string): boolean {
  return actor.permissions.includes(permission);
}

/** Методист не может выдавать или снимать роль администратора. */
export function canEditUserRoles(actor: Actor, targetRoleCodes: string[], nextRoleCodes: string[]): boolean {
  if (!hasPermission(actor, "roles.manage")) return false;
  const touchesAdmin = targetRoleCodes.includes("admin") || nextRoleCodes.includes("admin");
  if (touchesAdmin && !actor.roles.includes("admin")) return false;
  return true;
}
