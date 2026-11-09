"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { can, useSession } from "@/lib/session";

export function Shell({ children }: { children: React.ReactNode }) {
  const { actor } = useSession();
  const { t, locale, setLocale } = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (actor === null) router.replace("/login");
    if (actor) {
      document.documentElement.dataset.theme = actor.theme === "dark" ? "dark" : localStorage.getItem("lizon-theme") || "light";
      if (actor.accent) document.documentElement.style.setProperty("--accent", actor.accent);
      if (actor.locale === "en" || actor.locale === "ru") setLocale(actor.locale);
    }
  }, [actor, router, setLocale]);

  if (!actor) return <p className="main">{t("Открываем кабинет…", "Opening your desk…")}</p>;
  const item = (href: string, label: string) => (
    <Link href={href} className={pathname.startsWith(href) ? "active" : ""} onClick={() => setOpen(false)}>{label}</Link>
  );
  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("lizon-theme", next);
    void api("/api/users/" + actor.id, { method: "PATCH", body: JSON.stringify({ theme: next }) });
  };
  return (
    <div className="shell">
      <aside className={open ? "sidebar open" : "sidebar"}>
        <div className="brand"><strong>Lizon</strong><span>{actor.roles.join(" · ")}</span></div>
        <nav className="nav">
          {item("/learn", t("Учёба", "Learn"))}
          {(can(actor, "content.author") || can(actor, "courses.create")) && item("/teach", t("Преподавание", "Teaching"))}
          {can(actor, "questions.manage") && item("/questions", t("Банк вопросов", "Question bank"))}
          {(can(actor, "quizzes.grade") || can(actor, "assignments.grade")) && item("/grading", t("Проверка", "Grading"))}
          {(can(actor, "users.manage") || can(actor, "settings.manage") || can(actor, "roles.manage")) && item("/admin", t("Управление", "Admin"))}
          {item("/certificates", t("Сертификаты", "Certificates"))}
          {item("/notifications", t("Уведомления", "Notifications"))}
          {item("/profile", t("Профиль", "Profile"))}
        </nav>
        <div className="side-tools">
          <button type="button" onClick={toggleTheme}>{t("Тема", "Theme")}</button>
          <button type="button" onClick={() => setLocale(locale === "ru" ? "en" : "ru")}>{locale === "ru" ? "EN" : "RU"}</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="menu-btn" type="button" onClick={() => setOpen((value) => !value)}>{t("Меню", "Menu")}</button>
          <strong>Lizon</strong>
        </div>
        {children}
      </div>
    </div>
  );
}
