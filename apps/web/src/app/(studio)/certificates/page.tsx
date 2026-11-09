"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function CertificatesPage() {
  const { t } = useT();
  const [items, setItems] = useState<{ id: string; code: string; issuedAt: string; course: { title: string } }[]>([]);
  useEffect(() => { api<typeof items>("/api/certificates").then(setItems).catch(() => setItems([])); }, []);
  return (
    <section>
      <h1 className="page-title">{t("Сертификаты", "Certificates")}</h1>
      {items.length === 0 && <p className="muted">{t("Сертификат появится, когда курс будет пройден и работы проверены.", "A certificate appears after the course is finished and the work is graded.")}</p>}
      <div className="grid cards">
        {items.map((item) => (
          <article key={item.id} className="card">
            <h3>{item.course.title}</h3>
            <p>{item.code}</p>
            <a href={`/backend/api/certificates/${item.id}/pdf`}>{t("Скачать PDF", "Download PDF")}</a>
          </article>
        ))}
      </div>
    </section>
  );
}
