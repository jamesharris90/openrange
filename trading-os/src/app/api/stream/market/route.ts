import { addClient, removeClient } from "@/lib/server/market-event-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writeEvent = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      addClient(writeEvent);
      writeEvent({ type: "connected", timestamp: Date.now() });

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      }, 15000);

      const onAbort = () => {
        clearInterval(keepAlive);
        removeClient(writeEvent);
        controller.close();
      };

      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      // The listener is removed by the abort handler above.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
