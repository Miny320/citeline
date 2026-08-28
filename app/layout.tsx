import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION = "Chat with your documents, with citations you can actually check.";

export const metadata: Metadata = {
  title: { default: "Citeline", template: "%s · Citeline" },
  description: DESCRIPTION,
  applicationName: "Citeline",
  // Shown when the link is pasted into Slack, email or a chat client.
  openGraph: {
    title: "Citeline",
    description: DESCRIPTION,
    siteName: "Citeline",
    type: "website",
  },
  twitter: { card: "summary", title: "Citeline", description: DESCRIPTION },
  // A demo instance with no authentication has no business being indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Follows the system theme, so the browser chrome matches the page in both modes.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#131312" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
