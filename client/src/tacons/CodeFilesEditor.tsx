import { useState } from "react";
import { validCodePath, type CodeFiles } from "@shared/tacons/programs";

export function CodeFilesEditor({ files, onChange, disabled = false }: {
  files: CodeFiles; onChange: (files: CodeFiles) => void; disabled?: boolean;
}) {
  const paths = Object.keys(files).sort();
  const [selected, setSelected] = useState("");
  const [newPath, setNewPath] = useState("src/main.ts");
  const [error, setError] = useState("");
  const current = paths.includes(selected) ? selected : paths[0];
  return (
    <section className="space-y-3 rounded-lg border border-gray-200 p-4">
      <h3 className="font-semibold">JavaScript / TypeScript package files</h3>
      <p className="text-xs text-gray-600">
        Programs export a default function(eagle). They run in an isolated browser worker, not on the Eagle Bot server.
        Tac-Script declares their data reads and native form submissions. Local imports and CSS files are supported.
      </p>
      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer font-medium">Connect code with Tac-Script</summary>
        <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2">{'// Inside a page, panel or position:\nprogram "src/main.ts" {\n  height 400\n  // read my_store\n  // submit 1\n}'}</pre>
        <p className="mt-2">Your entry exports a default function(eagle). Use eagle.render(tree), eagle.on(name, handler),
          eagle.read(store), and eagle.submit(formIndex, values). Form indexes start at zero and must be declared
          with submit. Secret confirmation codes stay in native forms. Never include API keys or server credentials.</p>
      </details>
      <div className="flex flex-wrap gap-2">
        <input aria-label="New program file path" className="input min-w-0 flex-1" value={newPath} disabled={disabled} onChange={event => setNewPath(event.target.value)} />
        <button type="button" className="btn-secondary btn-sm" disabled={disabled || paths.length >= 40} onClick={() => {
          if (!validCodePath(newPath) || Object.hasOwn(files, newPath)) { setError("Choose a new relative JS, TS, JSX, TSX or CSS file path."); return; }
          onChange({ ...files, [newPath]: newPath.endsWith(".css") ? "" : 'export default function(eagle) {\n  eagle.render({ tag: "h2", text: "Hello from my Tac-On" });\n}\n' });
          setSelected(newPath); setError("");
        }}>Add file</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {current && <>
        <div className="flex gap-2">
          <select aria-label="Code file" className="input min-w-0 flex-1" value={current} disabled={disabled} onChange={event => setSelected(event.target.value)}>
            {paths.map(path => <option key={path}>{path}</option>)}
          </select>
          <button type="button" className="btn-ghost btn-sm" disabled={disabled} onClick={() => {
            const next = { ...files }; delete next[current]; onChange(next);
          }}>Remove file</button>
        </div>
        <textarea aria-label={`Code for ${current}`} spellCheck={false} className="input min-h-64 font-mono text-xs" value={files[current]} disabled={disabled}
          onChange={event => onChange({ ...files, [current]: event.target.value })} />
      </>}
    </section>
  );
}
