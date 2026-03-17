import { cn } from "@/lib/utils";

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <main className={cn("flex-1 overflow-hidden p-4 sm:p-6", className)}>{children}</main>;
}
