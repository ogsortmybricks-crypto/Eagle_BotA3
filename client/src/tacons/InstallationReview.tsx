import type { Manifest } from "@shared/tacons";
import { OPERATIONS, setupPlan, type AccessPolicy } from "@shared/tacons/contract";

const EXPLANATIONS: Record<string, string> = {
  "storage.read": "Read this installation's stored records, subject to its read audience.",
  "storage.write": "Write through declared native forms/actions, subject to their own checks.",
  "host.read": "Read declared Eagle Bot sources using the viewer's existing permissions.",
  "host.hooks": "Run declared native actions when matching Eagle Bot activity occurs.",
  "sharing.read": "Read explicitly provided data from another accessible installation.",
  "sharing.provide": "Allow other approved Tac-Ons to read the stores this package provides.",
  "extensions.discover": "Discover installed Tac-Ons visible to the current viewer.",
  "events.send": "Send declared topics to approved, accessible installations.",
  "events.receive": "Receive declared topics in this installation's event inbox.",
};
export function PermissionReview({ manifest, grants, onGrants, selectedSetup, onSetup, policy }: {
  manifest: Manifest; grants: string[]; onGrants: (value: string[]) => void;
  selectedSetup: string[]; onSetup: (value: string[]) => void; policy?: AccessPolicy;
}) {
  return <section className="space-y-4 rounded-lg border border-gray-200 p-3">
    <h3 className="font-semibold">Installation review</h3>
    <p className="text-xs text-gray-600">{manifest.contract ? "Manifest format 2 · SDK 1. Access is checked by Eagle Bot on every operation. Unchecked capabilities remain denied." : "Legacy package: existing native permissions apply. It receives no new discovery/event APIs."}</p>
    {manifest.contract && <dl className="grid grid-cols-2 gap-2 text-xs">
      {OPERATIONS.map(operation => <div key={operation}><dt className="font-semibold capitalize">{operation}</dt>
        <dd className="break-words">{(policy?.[operation] ?? manifest.contract!.access[operation]).join(", ") || "everyone"}</dd></div>)}
    </dl>}
    {(manifest.contract?.capabilities ?? []).map(capability => <label className="flex items-start gap-2 text-sm" key={capability}>
      <input type="checkbox" className="mt-1" checked={grants.includes(capability)} onChange={event => onGrants(event.target.checked ? [...grants, capability] : grants.filter(value => value !== capability))} />
      <span><strong>{capability}</strong><span className="block text-xs text-gray-600">{EXPLANATIONS[capability]}</span></span>
    </label>)}
    {(manifest.contract?.emits.length || manifest.contract?.listens.length) ? <p className="break-words text-xs text-gray-600">
      Sends: {manifest.contract.emits.join(", ") || "none"} · Receives: {manifest.contract.listens.join(", ") || "none"}.
      Events stay within the academy and compatible studio scope.
    </p> : null}
    <div>
      <h4 className="text-sm font-semibold">Host setup actions</h4>
      {setupPlan(manifest).length === 0 && <p className="text-xs text-gray-600">None. Installing will not create host records.</p>}
      {setupPlan(manifest).map(step => <div key={step.id} className="mt-2">
        <label className="flex items-start gap-2 text-sm">
          <input className="mt-1" type="checkbox" disabled={!step.optional} checked={!step.optional || selectedSetup.includes(step.id)}
            onChange={event => onSetup(event.target.checked ? [...selectedSetup, step.id] : selectedSetup.filter(id => id !== step.id))} />
          <span><strong>{step.optional ? "Optional" : "Required"}: synchronize positions</strong>
            <span className="block text-xs text-gray-600">{step.purpose}</span></span>
        </label>
        <ul className="ml-6 mt-1 list-disc text-xs text-gray-600">{manifest.positions.map(position => <li key={position.name}>{position.title} · {position.seats} seat(s)</li>)}</ul>
        <p className="ml-6 mt-1 text-xs text-gray-600">Uses ordinary Eagle Bot positions. Retries update the same seats rather than duplicate them. Skipping archives previously created seats without deleting their history.</p>
      </div>)}
    </div>
    <p className="text-xs text-gray-600">Turning off keeps saved data. Updating keeps records and settings. Uninstalling deletes this installation's records and incoming/outgoing event messages, and archives its positions.</p>
  </section>;
}
