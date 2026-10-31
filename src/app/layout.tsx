import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * Self-hosted variable fonts, so the build and the browser never depend on a
 * third-party font host. Fraunces (display) gives the editorial voice; Inter
 * (interface) keeps the measured data legible at small sizes.
 * Both are SIL Open Font License 1.1 - see ./fonts/OFL-*.txt.
 */
const display = localFont({
  src: "./fonts/Fraunces-Variable.woff2",
  variable: "--font-fraunces",
  weight: "300 700",
  style: "normal",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
  adjustFontFallback: "Times New Roman",
});

const sans = localFont({
  src: "./fonts/Inter-Variable.woff2",
  variable: "--font-inter",
  weight: "300 700",
  style: "normal",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Roboto", "sans-serif"],
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: "Chroma — Your colours. Your signature look.",
  description:
    "Upload one photo. Chroma measures the colours on your face with the YouCam API and builds a makeup palette, look set and shade match that is yours alone.",
  applicationName: "Chroma",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0c10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
