"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export default function RegisterPage() {
  const { t } = useT();
  const router = useRouter();
  const { reload } = useSession();
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "" });
  const [error, setError] = useState("");
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/auth/register", { method: "POST", body: JSON.stringify(form) });
      await reload();
      router.push("/learn");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("Не удалось зарегистрироваться", "Could not register"));
    }
  };
  return (
    <main className="main" style={{ maxWidth: 460 }}>
      <h1 className="page-title">{t("Регистрация", "Register")}</h1>
      <form className="card" onSubmit={submit}>
        <label className="field"><span>{t("Имя", "First name")}</span><input value={form.firstName} onChange={(event) => set("firstName", event.target.value)} required /></label>
        <label className="field"><span>{t("Фамилия", "Last name")}</span><input value={form.lastName} onChange={(event) => set("lastName", event.target.value)} required /></label>
        <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} required /></label>
        <label className="field"><span>{t("Пароль", "Password")}</span><input type="password" minLength={8} value={form.password} onChange={(event) => set("password", event.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">{t("Создать", "Create")}</button>
      </form>
    </main>
  );
}
