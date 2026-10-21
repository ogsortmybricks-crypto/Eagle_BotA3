import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost } from "@/lib/api";
import { Banner } from "@/components/ui";
import type { ViewProgram } from "@shared/tacons/programs";
import type { RenderTarget } from "./Renderer";

/** No executable package text is ever evaluated in the Eagle Bot window. */
export function ProgramView({ program, target }: { program: ViewProgram; target: RenderTarget }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const snapshot = JSON.stringify([program.bundle, program.data, program.viewer, program.settings]);
  const token = useMemo(() => crypto.randomUUID(), [snapshot]);
  useEffect(() => {
    setError(null);
    let calls = 0;
    let needsRefresh = false;
    const started = Date.now();
    const receive = async (event: MessageEvent) => {
      const child = frame.current?.contentWindow;
      if (!child || event.source !== child || event.data?.token !== token) return;
      const message = event.data;
      if (message.type === "idle") {
        if (needsRefresh) { needsRefresh = false; target.onChanged(); }
        return;
      }
      if (message.type === "error") {
        setError(String(message.error).slice(0, 1000));
        return;
      }
      if (message.type !== "rpc" || typeof message.id !== "number") return;
      const reply = (result: unknown, error?: string) => child.postMessage({ type: "reply", token, id: message.id, result, error }, "*");
      try {
        if (++calls > 60 + Math.floor((Date.now() - started) / 1000)) throw new Error("Program request limit reached. Reload the page before retrying.");
        if (["extensions.discover", "events.send", "events.read"].includes(message.method)) {
          if (JSON.stringify(message.args ?? {}).length > 20_000) throw new Error("SDK arguments exceed the size limit.");
          const response = await apiPost<{ result: unknown }>(`/tacons/sdk/${target.installId}/rpc`, {
            sdk: 1, page: target.page, panel: target.panel, position: target.position,
            index: program.index, method: message.method, args: message.args ?? {},
          });
          reply(response.result);
          return;
        }
        if (message.method !== "submit" || !Number.isInteger(message.index) || !program.submits.includes(message.index)) {
          throw new Error("This program has not declared permission for that form.");
        }
        if (!message.values || typeof message.values !== "object" || Array.isArray(message.values) || JSON.stringify(message.values).length > 30_000) {
          throw new Error("Program form values must be an object under 30 KB.");
        }
        // No confirmation code, scope, URL, install id or viewer can be supplied
        // by package code. The native endpoint rechecks audience/visibility.
        const result = await apiPost(`/tacons/view/${target.installId}/submit`, {
          page: target.page, panel: target.panel, position: target.position,
          index: message.index, values: message.values,
        });
        needsRefresh = true;
        reply(result);
      } catch (error) {
        reply(null, error instanceof Error ? error.message : "The program request failed.");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [token, program.submits, target]);
  return (
    <section className="space-y-2">
      {error && <Banner tone="error" title="Tac-On program stopped">{error}</Banner>}
      <iframe
        key={token}
        ref={frame}
        src="/tacon-sandbox.html"
        sandbox="allow-scripts"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        referrerPolicy="no-referrer"
        title={`Tac-On program: ${program.entry}`}
        className="w-full rounded-lg border border-gray-200 bg-white"
        style={{ height: program.height }}
        onLoad={() => frame.current?.contentWindow?.postMessage({
          type: "init", token, bundle: program.bundle,
          data: program.data, viewer: program.viewer, settings: program.settings ?? {},
        }, "*")}
      />
    </section>
  );
}
