import type { Metadata } from "next";

import { AdminView } from "@/components/terminal/admin-view";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Admin | OpenRange",
  "System diagnostics, engine monitoring, user controls, and email analytics for platform oversight.",
  "/admin"
);

export default function AdminPage() {
  return <AdminView />;
}
