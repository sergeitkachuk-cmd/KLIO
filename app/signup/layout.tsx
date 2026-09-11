import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Регистрация в КЛИО",
  alternates: { canonical: "/signup" },
  robots: { index: false, follow: false },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) { return children; }
