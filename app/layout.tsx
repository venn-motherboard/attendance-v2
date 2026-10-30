import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Classroom Attendance" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><main className="mx-auto max-w-3xl p-4">{children}</main></body>
    </html>
  );
}
