import { describe, expect, it } from "vitest";
import { canEditUserRoles, type Actor } from "../src/common/actor";

const actor = (roles: string[], permissions: string[]): Actor => ({
  id: "u",
  email: "a@lizon.test",
  firstName: "A",
  lastName: "B",
  locale: "ru",
  theme: "light",
  accent: null,
  roles,
  permissions,
  customFields: {},
});

describe("role changes", () => {
  it("lets an admin edit the admin role and stops a methodist", () => {
    const admin = actor(["admin"], ["roles.manage"]);
    const methodist = actor(["methodist"], ["roles.manage"]);
    expect(canEditUserRoles(admin, ["student"], ["admin"])).toBe(true);
    expect(canEditUserRoles(methodist, ["student"], ["teacher"])).toBe(true);
    expect(canEditUserRoles(methodist, ["admin"], ["admin"])).toBe(false);
    expect(canEditUserRoles(methodist, ["student"], ["admin"])).toBe(false);
  });
});
