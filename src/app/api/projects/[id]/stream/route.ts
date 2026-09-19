import { getProject } from "@/lib/db";
import { recentEvents, subscribe, toEventJSON } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) return new Response("not found", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const history = recentEvents(id, 150);
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      for (const e of history) {
        controller.enqueue(encoder.encode(`data: ${toEventJSON(e)}\n\n`));
      }

      const unsubscribe = subscribe(id, (e) => {
        try {
          controller.enqueue(encoder.encode(`data: ${toEventJSON(e)}\n\n`));
        } catch {
          if (cleanup) cleanup();
        }
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          if (cleanup) cleanup();
        }
      }, 15000);

      cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
    },
    cancel() {
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}