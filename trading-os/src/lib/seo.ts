import type { Metadata } from "next";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001";

export function createPageMetadata(title: string, description: string, path: string): Metadata {
  const url = `${baseUrl}${path}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      siteName: "OpenRange Trading Terminal",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
