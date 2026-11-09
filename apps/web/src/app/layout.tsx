import type { Metadata } from "next";
import { Manrope, Source_Serif_4 } from "next/font/google";
import { LocaleProvider } from "@/lib/i18n";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

const sans = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-sans" });
const serif = Source_Serif_4({ subsets: ["latin", "cyrillic"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "Lizon",
  description: "Гибкая учебная платформа",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('lizon-theme');if(t)document.documentElement.dataset.theme=t;var l=localStorage.getItem('lizon-locale');if(l)document.documentElement.lang=l;}catch(e){}" }} />
      </head>
      <body>
        <LocaleProvider>
          <SessionProvider>{children}</SessionProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
