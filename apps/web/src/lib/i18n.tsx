"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Locale = "ru" | "en";

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({
  locale: "ru",
  setLocale: () => undefined,
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ru");
  useEffect(() => {
    const saved = localStorage.getItem("lizon-locale");
    if (saved === "en" || saved === "ru") setLocaleState(saved);
  }, []);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem("lizon-locale", next);
    document.documentElement.lang = next;
  }, []);
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useT() {
  const { locale, setLocale } = useContext(LocaleContext);
  const t = (ru: string, en: string) => (locale === "en" ? en : ru);
  return { t, locale, setLocale };
}
