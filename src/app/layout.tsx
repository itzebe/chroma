import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chroma — Skin intelligence and virtual try-on",
  description:
    "Measure your facial colours with the YouCam API, get a seasonal colour profile, and see computed makeup looks and garment verdicts. Built for the YouCam API Skin AI & eCommerce VTO Hackathon.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
