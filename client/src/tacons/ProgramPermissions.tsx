import type { Manifest } from "@shared/tacons";

export function ProgramPermissions({ manifest }: { manifest: Manifest }) {
  const programs = [...manifest.pages, ...manifest.panels, ...manifest.positions]
    .flatMap(owner => owner.widgets).filter(widget => widget.kind === "program");
  if (!programs.length) return null;
  return (
    <section className="my-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
      <h3 className="font-semibold">Executable JavaScript / TypeScript programs</h3>
      <p className="mt-1 text-xs text-gray-700">
        This package runs developer code in isolated browser workers. Programs cannot access your session,
        the server filesystem or external networks. Native form permissions still apply. Review the developer and declared data access before installing.
      </p>
      <ul className="mt-2 space-y-2">
        {programs.map((program, index) => <li key={index}>
          <code className="break-all">{program.entry}</code>
          <div className="text-xs">Reads: {program.reads.join(", ") || "none"}. Form submissions: {program.submits.join(", ") || "none"}.</div>
        </li>)}
      </ul>
    </section>
  );
}
