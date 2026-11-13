"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function NotificationsPage() {
  const { t } = useT();
  const [items, setItems] = useState<{ id: string; title: string; body: string; readAt: string | null; createdAt: string }[]>([]);
  const [prefs, setPrefs] = useState<{ event: string; inApp: boolean; email: boolean }[]>([]);
  const load = () => {
    void api<{ items: typeof items }>("/api/notifications").then((data) => setItems(data.items));
    void api<typeof prefs>("/api/notifications/preferences").then(setPrefs);
  };
  useEffect(() => { load(); }, []);
  return (
    <section className="stack">
      <div className="spread"><h1 className="page-title">{t("Уведомления", "Notifications")}</h1><button className="ghost" type="button" onClick={() => api("/api/notifications/read", { method: "POST", body: "{}" }).then(load)}>{t("Прочитать все", "Mark all read")}</button></div>
      {items.length === 0 && <p className="muted">{t("Пока тихо.", "Nothing yet.")}</p>}
      {items.map((item) => <article key={item.id} className="card"><h3>{item.title}</h3><p>{item.body}</p><p className="muted">{item.readAt ? t("прочитано", "read") : t("новое", "new")}</p></article>)}
      <article className="card">
        <h3>{t("Каналы", "Channels")}</h3>
        {prefs.map((pref) => (
          <label key={pref.event} className="spread">
            <span>{pref.event}</span>
            <span>
              <input type="checkbox" checked={pref.inApp} onChange={(event) => setPrefs(prefs.map((item) => item.event === pref.event ? { ...item, inApp: event.target.checked } : item))} /> in-app
              <input type="checkbox" checked={pref.email} onChange={(event) => setPrefs(prefs.map((item) => item.event === pref.event ? { ...item, email: event.target.checked } : item))} /> email
            </span>
          </label>
        ))}
        <button className="primary" type="button" onClick={() => api("/api/notifications/preferences", { method: "PUT", body: JSON.stringify({ items: prefs }) })}>{t("Сохранить", "Save")}</button>
      </article>
    </section>
  );
}
