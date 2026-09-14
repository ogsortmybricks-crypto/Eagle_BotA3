import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Feather, Upload } from "lucide-react";
import { apiPost, fileToDataUrl } from "@/lib/api";
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

  const palette = PALETTES[paletteIndex].palette;

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

  const domainClean = emailDomain.trim().toLowerCase().replace(/^@/, "");
  const step0Valid = academyName.trim().length >= 2 && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domainClean);
  const step2Valid =
    adminName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(adminEmail) &&
    password.length >= 8 &&
    adminEmail.trim().toLowerCase().endsWith(`@${domainClean}`);

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
      });
      window.location.href = "/wiki";
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Setup failed.");
      setBusy(false);
    }
  }

  const steps = ["Your academy", "Look and feel", "Your account"];

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/20">
            <Feather className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Set up Eagle Bot</h1>
          <p className="mt-1.5 text-sm text-gray-600">
            One place where your studio's rules, Town Hall decisions, and elections stay current.
          </p>
        </div>

        <ol className="mb-6 flex items-center justify-center gap-2 text-xs font-medium">
          {steps.map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  index < step
                    ? "bg-brand-600 text-white"
                    : index === step
                      ? "bg-brand-600 text-white"
                      : "bg-gray-200 text-gray-500"
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
                  studio's record closed to outsiders.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="learner-noun">
                  What does your studio call its learners?
                </label>
                <input
                  id="learner-noun"
                  className="input"
                  value={learnerNoun}
                  onChange={(event) => setLearnerNoun(event.target.value)}
                  placeholder="Hero"
                />
                <p className="hint">Hero, Eagle, Explorer — whatever your studio actually says.</p>
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
                    out of the ballot box.
                  </span>
                </span>
              </label>
            </div>
          )}

          {step === 1 && (
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

          {step === 2 && (
            <div className="space-y-4">
              <Banner tone="info">
                You'll be the first admin. You can invite everyone else once you're in.
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
            {step < 2 ? (
              <button
                type="button"
                onClick={() => setStep((current) => current + 1)}
                disabled={step === 0 && !step0Valid}
                className="btn-primary"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!step2Valid || busy}
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
