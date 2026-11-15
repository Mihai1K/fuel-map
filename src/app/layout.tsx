import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ConsentBanner } from "@/components/consent";
import { Metrika } from "@/components/metrika";
import { Presence } from "@/components/presence";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // self-canonical по умолчанию — страницы с собственным canonical переопределяют
  alternates: { canonical: "./" },
  title: "Тут Бензин — карта наличия бензина на АЗС в реальном времени",
  description:
    "Онлайн-карта наличия бензина: водители отмечают, где есть топливо, какая очередь и когда информацию подтверждали. Без регистрации.",
  appleWebApp: {
    capable: true,
    title: "Тут Бензин",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  // Подтверждение прав в Яндекс Вебмастере — не удалять, проверяется постоянно
  verification: {
    yandex: "4e2598143fdb115b",
  },
  // превью ссылок в Telegram/VK/MAX
  openGraph: {
    type: "website",
    siteName: "Тут Бензин",
    title: "Тут Бензин — карта наличия бензина на АЗС",
    description:
      "Онлайн-карта АЗС России: водители отмечают, где есть топливо, очереди и лимиты. Бесплатно, без регистрации.",
    images: [{ url: "/icon-512.png", width: 512, height: 512 }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${inter.variable} h-full antialiased`}>
      <body className="h-full">
        {children}
        <ConsentBanner />
        <Metrika />
        <Presence />
      </body>
    </html>
  );
}
