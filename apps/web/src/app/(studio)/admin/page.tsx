"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { can, RequirePermission, useSession } from "@/lib/session";

export default function AdminPage() {
  const { t } = useT();
  const { actor } = useSession();
  const [users, setUsers] = useState<{ id: string; email: string; firstName: string; lastName: string; roles: string[] }[]>([]);
  const [roles, setRoles] = useState<{ id: string; code: string; permissions: string[] }[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [fields, setFields] = useState<{ id: string; entity: string; key: string; label: string }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (can(actor, "users.read")) api<{ items: typeof users }>("/api/users").then((data) => setUsers(data.items)).catch(() => undefined);
    if (can(actor, "roles.manage")) api<typeof roles>("/api/roles").then(setRoles).catch(() => undefined);
    api<Record<string, unknown>>("/api/settings").then(setSettings).catch(() => undefined);
    api<typeof fields>("/api/custom-fields").then(setFields).catch(() => undefined);
    api<typeof templates>("/api/templates").then(setTemplates).catch(() => undefined);
  }, [actor]);
  return (
    <RequirePermission anyOf={["users.manage", "settings.manage", "roles.manage"]}>
    <section className="stack">
      <h1 className="page-title">{t("Управление", "Admin")}</h1>
      <article className="card">
        <h3>{t("Платформа", "Platform")}</h3>
        <p>{t("Регистрация", "Registration")}: {String(settings.allowRegistration)}</p>
        {can(actor, "settings.manage") && <button className="ghost" type="button" onClick={() => api("/api/settings", { method: "PUT", body: JSON.stringify({ allowRegistration: settings.allowRegistration === false }) }).then(() => setSettings({ ...settings, allowRegistration: settings.allowRegistration === false }))}>{t("Переключить регистрацию", "Toggle registration")}</button>}
        <ul>{fields.map((field) => <li key={field.id}>{field.entity}.{field.key} — {field.label}</li>)}</ul>
      </article>
      <article className="card">
        <h3>{t("Шаблоны", "Templates")}</h3>
        {templates.map((template) => (
          <div key={template.id} className="spread">
            <span>{template.name}</span>
            {can(actor, "courses.create") && <button className="tiny" type="button" onClick={() => api("/api/templates/" + template.id + "/instantiate", { method: "POST", body: JSON.stringify({}) }).then(() => alert(t("Курс создан", "Course created")))}>{t("Создать курс", "Create course")}</button>}
          </div>
        ))}
      </article>
      <article className="card">
        <h3>{t("Люди и роли", "People and roles")}</h3>
        <table className="table">
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.firstName} {user.lastName}<br /><span className="muted">{user.email}</span></td>
                <td>{user.roles.join(", ")}</td>
                <td>{can(actor, "roles.manage") && roles.filter((role) => role.code !== "admin" || actor?.roles.includes("admin")).map((role) => (
                  <button key={role.code} className="tiny" type="button" onClick={() => api(`/api/users/${user.id}/roles`, { method: "PUT", body: JSON.stringify({ roleCodes: [...new Set([...user.roles, role.code])] }) }).then(() => location.reload())}>+{role.code}</button>
                ))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
    </RequirePermission>
  );
}
