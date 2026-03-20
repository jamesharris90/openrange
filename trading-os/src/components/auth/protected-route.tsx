"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { initialized, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!initialized || isAuthenticated) return;

    const nextTarget = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${nextTarget}`);
  }, [initialized, isAuthenticated, pathname, router]);

  if (!initialized) {
    return null;
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
