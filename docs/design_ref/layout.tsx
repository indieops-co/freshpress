import type { Metadata } from "next";
import { Inter, Cormorant_Garamond, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const bodySans = Inter({
  variable: "--font-body-sans",
  subsets: ["latin"],
});

const displaySerif = Cormorant_Garamond({
  variable: "--font-display-serif",
  weight: ["500"],
  subsets: ["latin"],
});

const codeMono = JetBrains_Mono({
  variable: "--font-code-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JobFile Finder",
  description: "Private AI search across your business files",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bodySans.variable} ${displaySerif.variable} ${codeMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
