"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api, type Actor } from "./api";
import { useT } from "./i18n";

const SessionContext = createContext<{ actor: Actor | null | undefined; reload: () => Promise<void> }>({
  actor: undefined,
  reload: async () => undefined,
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [actor, setActor] = useState<Actor | null | undefined>(undefined);
  const reload = async () => {
    try {
      setActor(await api<Actor>("/api/auth/me"));
    } catch {
      setActor(null);
    }
  };
  useEffect(() => {
    void reload();
  }, []);
  return <SessionContext.Provider value={{ actor, reload }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

export function can(actor: Actor | null | undefined, permission: string) {
  return Boolean(actor?.permissions.includes(permission));
}

export function RequirePermission({ anyOf, children }: { anyOf: string[]; children: React.ReactNode }) {
  const { actor } = useSession();
  const { t } = useT();
  const router = useRouter();
  const allowed = anyOf.some((permission) => can(actor, permission));
  useEffect(() => {
    if (actor && !allowed) router.replace("/learn");
  }, [actor, allowed, router]);
  if (!actor || !allowed) return <p className="muted">{t("Этой страницы нет в вашей роли.", "This page is outside your role.")}</p>;
  return children;
}
