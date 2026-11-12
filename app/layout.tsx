import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavTabs } from "@/components/nav-tabs";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OneDrive Manager",
  description: "Where you have free space across your OneDrive accounts — and moving things between them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-transparent text-white/90">
        {/* Background photo + a scrim so text on glass stays readable. */}
        <div
          aria-hidden
          className="fixed inset-0 -z-20 bg-cover bg-center"
          style={{ backgroundImage: "url(/background.jpg)" }}
        />
        <div aria-hidden className="fixed inset-0 -z-10 bg-gradient-to-b from-black/40 via-black/20 to-black/50" />
        <NavTabs />
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-16 sm:px-8">{children}</main>
      </body>
    </html>
  );
}
