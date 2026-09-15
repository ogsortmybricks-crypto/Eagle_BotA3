import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Feather, Plus, Trash2, Upload, X } from "lucide-react";
import { apiGet, apiPost, fileToDataUrl } from "@/lib/api";
import { applyPalette, type Palette } from "@/lib/session";
import { Banner, Spinner } from "@/components/ui";

const PALETTES: { name: string; palette: Palette }[] = [
  { name: "Sky", palette: { primary: "#0284c7", accent: "#f97316", surface: "#f8fafc" } },
  { name: "Forest", palette: { primary: "#15803d", accent: "#ca8a04", surface: "#f7faf7" } },
  { name: "Ember", palette: { primary: "#b91c1c", accent: "#0891b2", surface: "#fbf8f7" } },
  { name: "Ink", palette: { primary: "#1e293b", accent: "#d97706", surface: "#f8fafc" } },
  { name: "Violet", palette: { primary: "#6d28d9", accent: "#059669", surface: "#faf9fd" } },
  { name: "Clay", palette: { primary: "#9a3412", accent: "#0f766e", surface: "#fcf9f6" } },
];

const STUDIO_COLORS = [
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ef4444",
  "#0891b2",
  "#ec4899",
  "#64748b",
];

type StudioDraft = {
  name: string;
  description: string;
  ageRange: string;
  color: string;
  learnerNoun: string;
};

type Preset = { name: string; ageRange: string; color: string; description: string };

const FALLBACK_PRESETS: Preset[] = [
  { name: "Spark", ageRange: "4-7", color: "#f59e0b", description: "The youngest studio." },
  { name: "Discovery", ageRange: "7-11", color: "#10b981", description: "Elementary studio." },
  { name: "Middle Studio", ageRange: "11-14", color: "#3b82f6", description: "Quests and Exhibitions." },
  { name: "Launchpad", ageRange: "14-18", color: "#8b5cf6", description: "The final studio." },
  { name: "Staff", ageRange: "Adults", color: "#64748b", description: "Guides and staff." },
];

export function Setup() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [academyName, setAcademyName] = useState("");
  const [emailDomain, setEmailDomain] = useState("");
  const [learnerNoun, setLearnerNoun] = useState("Hero");
  const [guidesCanVote, setGuidesCanVote] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [password, setPassword] = useState("");

  const [presets, setPresets] = useState<Preset[]>(FALLBACK_PRESETS);
  const [studioDrafts, setStudioDrafts] = useState<StudioDraft[]>([]);
  const [adminStudioIndex, setAdminStudioIndex] = useState<number | null>(null);

  const palette = PALETTES[paletteIndex].palette;

  useEffect(() => {
    apiGet<{ studioPresets?: Preset[] }>("/setup/status")
      .then((data) => {
        if (data.studioPresets?.length) setPresets(data.studioPresets);
      })
      .catch(() => undefined);
  }, []);

  function choosePalette(index: number) {
    setPaletteIndex(index);
    applyPalette(PALETTES[index].palette);
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setLogoUrl(await fileToDataUrl(file, 500_000));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Couldn't read that image.");
    }
  }

  function addPreset(preset: Preset) {
    setStudioDrafts((current) => [
      ...current,
      {
        name: preset.name,
        description: preset.description,
        ageRange: preset.ageRange,
        color: preset.color,
        learnerNoun: "",
      },
    ]);
  }

  function addBlank() {
    setStudioDrafts((current) => [
      ...current,
      {
        name: "",
        description: "",
        ageRange: "",
        color: STUDIO_COLORS[current.length % STUDIO_COLORS.length],
        learnerNoun: "",
      },
    ]);
  }

  function updateStudio(index: number, patch: Partial<StudioDraft>) {
    setStudioDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    );
  }

  function removeStudio(index: number) {
    setStudioDrafts((current) => current.filter((_, i) => i !== index));
    setAdminStudioIndex((current) => {
      if (current === null) return null;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  }

  const domainClean = emailDomain.trim().toLowerCase().replace(/^@/, "");
  const step0Valid = academyName.trim().length >= 2 && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domainClean);
  const namedStudios = studioDrafts.filter((draft) => draft.name.trim().length >= 2);
  const step1Valid = namedStudios.length >= 1 && namedStudios.length === studioDrafts.length;
  const step3Valid =
    adminName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(adminEmail) &&
    password.length >= 8 &&
    adminEmail.trim().toLowerCase().endsWith(`@${domainClean}`);

  const availablePresets = presets.filter(
    (preset) => !studioDrafts.some((draft) => draft.name.trim() === preset.name),
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/setup", {
        academyName: academyName.trim(),
        emailDomain: domainClean,
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim().toLowerCase(),
        password,
        palette,
        logoUrl,
        learnerNoun: learnerNoun.trim() || "Hero",
        guidesCanVote,
        studios: studioDrafts.map((draft) => ({
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          ageRange: draft.ageRange.trim() || null,
          color: draft.color,
          learnerNoun: draft.learnerNoun.trim() || null,
        })),
        adminStudioIndex,
      });
      window.location.href = "/wiki";
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Setup failed.");
      setBusy(false);
    }
  }

  const steps = ["Your academy", "Studios", "Look and feel", "Your account"];

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/20">
            <Feather className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Set up Eagle Bot</h1>
          <p className="mt-1.5 text-sm text-gray-600">
            One place where each studio's rules, Town Hall decisions, and elections stay current.
          </p>
        </div>

        <ol className="mb-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-medium">
          {steps.map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  index <= step ? "bg-brand-600 text-white" : "bg-gray-200 text-gray-500"
                }`}
              >
                {index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className={index === step ? "text-gray-900" : "text-gray-500"}>{label}</span>
              {index < steps.length - 1 && <span className="mx-1 text-gray-300">—</span>}
            </li>
          ))}
        </ol>

        <div className="card p-6">
          {error && (
            <div className="mb-4">
              <Banner tone="error">{error}</Banner>
            </div>
          )}

          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="academy-name">
                  Academy name
                </label>
                <input
                  id="academy-name"
                  className="input"
                  value={academyName}
                  onChange={(event) => setAcademyName(event.target.value)}
                  placeholder="Acton Academy Riverbend"
                  autoFocus
                />
              </div>
              <div>
                <label className="label" htmlFor="domain">
                  Email domain
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-400">@</span>
                  <input
                    id="domain"
                    className="input"
                    value={emailDomain}
                    onChange={(event) => setEmailDomain(event.target.value)}
                    placeholder="riverbendacton.com"
                  />
                </div>
                <p className="hint">
                  Only people with an email on this domain can be invited. This is what keeps the
                  academy's record closed to outsiders.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="learner-noun">
                  What does your academy call its learners?
                </label>
                <input
                  id="learner-noun"
                  className="input"
                  value={learnerNoun}
                  onChange={(event) => setLearnerNoun(event.target.value)}
                  placeholder="Hero"
                />
                <p className="hint">
                  Hero, Eagle, Explorer — whatever your studios actually say. Individual studios can
                  use their own word.
                </p>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3.5">
                <input
                  type="checkbox"
                  checked={guidesCanVote}
                  onChange={(event) => setGuidesCanVote(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm">
                  <span className="font-medium text-gray-900">Guides can vote in elections</span>
                  <span className="mt-0.5 block text-gray-500">
                    Off by default. Governance belongs to the studio, and most Actons keep adults
                    out of the ballot box. You can change this per studio later.
                  </span>
                </span>
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <Banner tone="info" title="Studios are the unit of governance">
                Each studio keeps its own rules, its own elected positions, and its own Town Halls.
                Nothing crosses between them unless you deliberately file it academy-wide. Describe
                the ones your academy runs — the descriptions are read by the AI when it writes each
                studio's wiki, so they're worth a sentence.
              </Banner>

              {availablePresets.length > 0 && (
                <div>
                  <span className="label">Start from the usual ones</span>
                  <div className="flex flex-wrap gap-2">
                    {availablePresets.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => addPreset(preset)}
                        className="btn-secondary btn-sm"
                      >
                        <Plus className="h-3 w-3" /> {preset.name}
                        <span className="text-gray-400">{preset.ageRange}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {studioDrafts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center">
                  <p className="text-sm text-gray-500">
                    No studios yet. Add one above, or build your own.
                  </p>
                  <button type="button" onClick={addBlank} className="btn-primary btn-sm mt-3">
                    <Plus className="h-3.5 w-3.5" /> Add a studio
                  </button>
                </div>
              ) : (
                <ul className="space-y-3">
                  {studioDrafts.map((draft, index) => (
                    <li key={index} className="rounded-lg border border-gray-200 p-3.5">
                      <div className="flex items-start gap-3">
                        <div className="flex shrink-0 flex-col items-center gap-1.5 pt-1">
                          <span
                            className="h-6 w-6 rounded-full ring-2 ring-white"
                            style={{ background: draft.color }}
                          />
                        </div>
                        <div className="min-w-0 flex-1 space-y-2.5">
                          <div className="flex gap-2">
                            <input
                              className="input"
                              value={draft.name}
                              onChange={(event) => updateStudio(index, { name: event.target.value })}
                              placeholder="Studio name"
                              aria-label="Studio name"
                            />
                            <input
                              className="input w-28 shrink-0"
                              value={draft.ageRange}
                              onChange={(event) =>
                                updateStudio(index, { ageRange: event.target.value })
                              }
                              placeholder="Ages"
                              aria-label="Age range"
                            />
                          </div>
                          <textarea
                            className="input min-h-[60px] text-[13px]"
                            value={draft.description}
                            onChange={(event) =>
                              updateStudio(index, { description: event.target.value })
                            }
                            placeholder="What this studio is for, and how it governs itself. The AI reads this."
                            aria-label="Studio description"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="flex gap-1">
                              {STUDIO_COLORS.map((color) => (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => updateStudio(index, { color })}
                                  aria-label={`Colour ${color}`}
                                  className={`h-5 w-5 rounded-full transition ${
                                    draft.color === color
                                      ? "ring-2 ring-gray-900 ring-offset-1"
                                      : "hover:scale-110"
                                  }`}
                                  style={{ background: color }}
                                />
                              ))}
                            </div>
                            <input
                              className="input w-36 py-1 text-xs"
                              value={draft.learnerNoun}
                              onChange={(event) =>
                                updateStudio(index, { learnerNoun: event.target.value })
                              }
                              placeholder={`Calls them "${learnerNoun}"`}
                              aria-label="What this studio calls its learners"
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeStudio(index)}
                          className="btn-ghost shrink-0 p-1.5 text-gray-400 hover:text-red-600"
                          aria-label={`Remove ${draft.name || "studio"}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {studioDrafts.length > 0 && (
                <button type="button" onClick={addBlank} className="btn-secondary btn-sm">
                  <Plus className="h-3.5 w-3.5" /> Add another
                </button>
              )}

              {studioDrafts.length > 0 && !step1Valid && (
                <Banner tone="warning">Every studio needs a name of at least two characters.</Banner>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <span className="label">Colour palette</span>
                <div className="grid grid-cols-3 gap-2.5">
                  {PALETTES.map((option, index) => (
                    <button
                      key={option.name}
                      type="button"
                      onClick={() => choosePalette(index)}
                      className={`rounded-lg border-2 p-3 text-left transition ${
                        paletteIndex === index
                          ? "border-gray-900"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="mb-2 flex gap-1">
                        <span
                          className="h-5 w-5 rounded-full"
                          style={{ background: option.palette.primary }}
                        />
                        <span
                          className="h-5 w-5 rounded-full"
                          style={{ background: option.palette.accent }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-700">{option.name}</span>
                    </button>
                  ))}
                </div>
                <p className="hint">
                  This is the academy's palette. Each studio has its own accent colour, set above.
                </p>
              </div>

              <div>
                <span className="label">Logo (optional)</span>
                <div className="flex items-center gap-4">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Academy logo"
                      className="h-16 w-16 rounded-xl border border-gray-200 object-contain p-1"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-gray-300 text-gray-400">
                      <Upload className="h-5 w-5" />
                    </div>
                  )}
                  <div>
                    <label className="btn-secondary btn-sm cursor-pointer">
                      Choose image
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => onLogo(event.target.files?.[0])}
                      />
                    </label>
                    {logoUrl && (
                      <button
                        type="button"
                        onClick={() => setLogoUrl(null)}
                        className="btn-ghost btn-sm ml-1"
                      >
                        Remove
                      </button>
                    )}
                    <p className="hint">PNG or SVG, under 500KB.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Banner tone="info">
                You'll be the first admin. You can invite everyone else once you're in, and every
                other setting is adjustable later under Settings.
              </Banner>
              <div>
                <label className="label" htmlFor="admin-name">
                  Your name
                </label>
                <input
                  id="admin-name"
                  className="input"
                  value={adminName}
                  onChange={(event) => setAdminName(event.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="label" htmlFor="admin-email">
                  Your email
                </label>
                <input
                  id="admin-email"
                  type="email"
                  className="input"
                  value={adminEmail}
                  onChange={(event) => setAdminEmail(event.target.value)}
                  placeholder={`you@${domainClean || "youracton.com"}`}
                />
                {adminEmail && !adminEmail.toLowerCase().endsWith(`@${domainClean}`) && (
                  <p className="mt-1 text-xs text-red-600">
                    Needs to be on @{domainClean} — that's the domain you set for the academy.
                  </p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="admin-studio">
                  Which studio are you in?
                </label>
                <select
                  id="admin-studio"
                  className="input"
                  value={adminStudioIndex ?? ""}
                  onChange={(event) =>
                    setAdminStudioIndex(event.target.value === "" ? null : Number(event.target.value))
                  }
                >
                  <option value="">Not in a studio</option>
                  {studioDrafts.map((draft, index) => (
                    <option key={index} value={index}>
                      {draft.name || `Studio ${index + 1}`}
                    </option>
                  ))}
                </select>
                <p className="hint">
                  As an admin you can open every studio regardless. This just sets which one opens
                  first.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-gray-200 pt-5">
            <button
              type="button"
              onClick={() => setStep((current) => current - 1)}
              disabled={step === 0 || busy}
              className="btn-ghost"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep((current) => current + 1)}
                disabled={(step === 0 && !step0Valid) || (step === 1 && !step1Valid)}
                className="btn-primary"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!step3Valid || busy}
                className="btn-primary"
              >
                {busy ? <Spinner /> : <Check className="h-4 w-4" />} Create academy
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
