import { redirect } from "next/navigation";

export default function Page({ params }: { params: { ticker: string } }) {
  redirect(`/research-v2/${params.ticker}`);
}
