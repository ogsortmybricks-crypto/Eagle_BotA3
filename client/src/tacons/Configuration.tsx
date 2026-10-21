import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch } from "@/lib/api";
import { Banner, Modal, Spinner } from "@/components/ui";
import type { SettingDef } from "@shared/tacons";
import { useLocation } from "wouter";

/** Also reachable by a configurer whose role cannot open the extension UI. */
export function ConfigurationPage({ installId }: { installId: number }) {
  const [, navigate] = useLocation();
  return <ConfigurationModal installId={installId} onClose={() => navigate("/")} />;
}

export function ConfigurationButton({ installId }: { installId: number }) {
  const [open, setOpen] = useState(false);
  return <><button className="btn-secondary text-xs" onClick={() => setOpen(true)}>Tac-On settings</button>
    {open && <ConfigurationModal installId={installId} onClose={() => setOpen(false)} />}</>;
}
function ConfigurationModal({ installId, onClose }: { installId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const query = useQuery<{ settings: Record<string, unknown>; definitions: SettingDef[] }>({
    queryKey: ["tacon-configuration", installId], queryFn: () => apiGet(`/tacons/sdk/${installId}/configuration`), retry: false,
  });
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const values = draft ?? query.data?.settings ?? {};
  const save = useMutation({
    mutationFn: () => apiPatch(`/tacons/sdk/${installId}/configuration`, { settings: values }),
    onSuccess: () => { void queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith("tacon") }); onClose(); },
  });
  return <Modal open onClose={onClose} title="Tac-On settings" footer={<button className="btn-primary" disabled={!query.data || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Save settings</button>}>
    <div className="space-y-3">
      {(query.error || save.error) && <Banner tone="error">{(query.error ?? save.error)!.message}</Banner>}
      {query.isLoading && <Spinner />}
      {query.data?.definitions.length === 0 && <p className="text-sm text-gray-600">This package has no configurable settings.</p>}
      {query.data?.definitions.map(setting => <label className="block text-sm" key={setting.name}>
        <span className="label">{setting.label}</span>
        {setting.type === "boolean" ? <input type="checkbox" checked={Boolean(values[setting.name])} onChange={event => setDraft({ ...values, [setting.name]: event.target.checked })} /> :
          setting.type === "choice" ? <select className="input" value={String(values[setting.name] ?? "")} onChange={event => setDraft({ ...values, [setting.name]: event.target.value })}>{setting.options.map(option => <option key={option}>{option}</option>)}</select> :
            <input className="input" type={setting.type === "number" ? "number" : "text"} maxLength={2000} value={String(values[setting.name] ?? "")} onChange={event => setDraft({ ...values, [setting.name]: setting.type === "number" ? Number(event.target.value) : event.target.value })} />}
        {setting.hint && <span className="block text-xs text-gray-500">{setting.hint}</span>}
      </label>)}
      <p className="text-xs text-gray-500">Do not put passwords, tokens or API keys in Tac-On settings.</p>
    </div>
  </Modal>;
}
