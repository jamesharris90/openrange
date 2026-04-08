import dynamic from "next/dynamic";
import { NewsView } from "@/components/terminal/news-view";

function NewsPage() {
  return <NewsView />;
}

export default dynamic(() => Promise.resolve(NewsPage), { ssr: false });
