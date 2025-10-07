import { useAuth } from "./useAuth";
import { can, canAny, canAll, type Permission } from "@shared/permissions";
import type { UserRole } from "@shared/schema";

export function useCan() {
  const { user } = useAuth();
  const userRole = (user as any)?.role as UserRole | undefined;

  return {
    can: (permission: Permission): boolean => {
      if (!userRole) return false;
      return can(userRole, permission);
    },
    canAny: (permissions: Permission[]): boolean => {
      if (!userRole) return false;
      return canAny(userRole, permissions);
    },
    canAll: (permissions: Permission[]): boolean => {
      if (!userRole) return false;
      return canAll(userRole, permissions);
    },
    role: userRole,
  };
}
