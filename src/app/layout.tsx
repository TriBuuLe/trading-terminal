import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// IBM Plex Sans: compact, highly legible UI face (designed for dense data UIs).
// JetBrains Mono: crisp monospaced digits with tabular figures for prices/P&L.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Paper Terminal",
  description: "Paper trading terminal on real market data",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${plexSans.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden bg-background font-sans text-[13px] text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
