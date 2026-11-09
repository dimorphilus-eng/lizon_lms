"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export default function LoginPage() {
  const { t } = useT();
  const router = useRouter();
  const { reload } = useSession();
  const [email, setEmail] = useState("student@lizon.test");
  const [password, setPassword] = useState("LizonDemo!2026");
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      await reload();
      router.push("/learn");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("Не удалось войти", "Could not sign in"));
    }
  };

  return (
    <main className="main" style={{ maxWidth: 460 }}>
      <p className="kicker">Lizon</p>
      <h1 className="page-title">{t("Вход", "Sign in")}</h1>
      <form className="card" onSubmit={submit}>
        <label className="field"><span>Email</span><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></label>
        <label className="field"><span>{t("Пароль", "Password")}</span><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">{t("Войти", "Sign in")}</button>
        <p className="muted">{t("Демо-пароль для всех учёток: LizonDemo!2026. Почты: student, teacher, methodist, admin @lizon.test. У student2 сразу две роли.", "Demo password for every account: LizonDemo!2026. Mailboxes: student, teacher, methodist, admin @lizon.test. student2 holds two roles.")}</p>
        <p><a href="/backend/api/auth/oauth/google">{t("Войти через Google", "Continue with Google")}</a></p>
        <Link href="/register">{t("Создать аккаунт", "Create an account")}</Link>
      </form>
    </main>
  );
}
