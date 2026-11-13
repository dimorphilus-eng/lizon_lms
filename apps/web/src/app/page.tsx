"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

export default function HomePage() {
  const { t } = useT();
  return (
    <main className="landing">
      <section className="landing-copy">
        <p className="kicker">Lizon</p>
        <h1 className="page-title">{t("Учёба со структурой, а не с лабиринтом меню.", "Learning with structure, without the maze of menus.")}</h1>
        <p className="lede">{t("Курсы, банк вопросов почти как в Moodle и кабинеты студента, преподавателя и методиста. Один человек может носить несколько ролей.", "Courses, a Moodle-like question bank, and desks for learners, teachers and programme leads. One person can hold several roles.")}</p>
        <div className="row">
          <Link className="primary" href="/login" style={{ textDecoration: "none" }}>{t("Войти", "Sign in")}</Link>
          <Link className="ghost" href="/register" style={{ textDecoration: "none" }}>{t("Регистрация", "Register")}</Link>
        </div>
      </section>
      <aside className="landing-aside">
        <p className="kicker">01 — 03</p>
        <h2 style={{ fontFamily: "var(--serif)", fontWeight: 520 }}>{t("Курс, модуль, активность.", "Course, module, activity.")}</h2>
        <p>{t("Урок, тест, задание, обсуждение и симуляция живут в одной ленте. Доступ открывается по дате, оценке, группе или завершению предыдущего шага.", "A lesson, quiz, assignment, discussion and simulation share one path. Access opens by date, grade, group or the previous step.")}</p>
      </aside>
    </main>
  );
}
