import type { ReactNode } from "react";

type DataStateProps<T> = {
  loading?: boolean;
  error?: unknown;
  data?: T[] | T | null;
  children: ReactNode;
  emptyMessage?: string;
};

export function DataState<T>({
  loading,
  error,
  data,
  children,
  emptyMessage = "No data available",
}: DataStateProps<T>) {
  if (loading) return <div className="p-4 text-gray-400">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">Error loading data</div>;
  if (
    !data ||
    (Array.isArray(data) && data.length === 0)
  ) {
    return <div className="p-4 text-yellow-500">{emptyMessage}</div>;
  }

  return <>{children}</>;
}
