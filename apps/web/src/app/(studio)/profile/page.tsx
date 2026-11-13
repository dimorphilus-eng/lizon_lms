"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export default function ProfilePage() {
  const { t, setLocale } = useT();
  const { actor, reload } = useSession();
  const router = useRouter();
  const [firstName, setFirstName] = useState(actor?.firstName || "");
  const [lastName, setLastName] = useState(actor?.lastName || "");
  const [accent, setAccent] = useState(actor?.accent || "#c24d32");
  const [password, setPassword] = useState({ current: "", next: "" });
  const [message, setMessage] = useState("");
  if (!actor) return null;
  return (
    <section className="stack" style={{ maxWidth: 560 }}>
      <h1 className="page-title">{t("Профиль", "Profile")}</h1>
      <p className="muted">{actor.email} · {actor.roles.join(", ")}</p>
      <form className="card" onSubmit={(event) => {
        event.preventDefault();
        void api(`/api/users/${actor.id}`, { method: "PATCH", body: JSON.stringify({ firstName, lastName, accent, customFields: actor.customFields }) }).then(async () => { setMessage(t("Сохранено", "Saved")); await reload(); });
      }}>
        <label className="field"><span>{t("Имя", "First name")}</span><input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
        <label className="field"><span>{t("Фамилия", "Last name")}</span><input value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
        <label className="field"><span>{t("Акцентный цвет", "Accent")}</span><input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /></label>
        <label className="field"><span>{t("Язык", "Language")}</span>
          <select defaultValue={actor.locale} onChange={(event) => { const locale = event.target.value as "ru" | "en"; setLocale(locale); void api(`/api/users/${actor.id}`, { method: "PATCH", body: JSON.stringify({ locale }) }); }}>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
        <button className="primary" type="submit">{t("Сохранить", "Save")}</button>
      </form>
      <form className="card" onSubmit={(event) => { event.preventDefault(); void api("/api/auth/password", { method: "POST", body: JSON.stringify(password) }).then(() => setMessage(t("Пароль обновлён", "Password updated"))); }}>
        <label className="field"><span>{t("Текущий пароль", "Current password")}</span><input type="password" value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} /></label>
        <label className="field"><span>{t("Новый пароль", "New password")}</span><input type="password" value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} /></label>
        <button className="ghost" type="submit">{t("Сменить пароль", "Change password")}</button>
      </form>
      {message && <p>{message}</p>}
      <button className="ghost" type="button" onClick={() => api("/api/auth/logout", { method: "POST" }).then(() => router.push("/"))}>{t("Выйти", "Sign out")}</button>
    </section>
  );
}
