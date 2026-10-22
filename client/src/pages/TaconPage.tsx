/**
 * A page an installed Tac-On added.
 *
 * It sits inside the normal layout, under the normal sidebar, tinted with the
 * academy's own palette - a Tac-On is part of the app, not a frame inside it.
 * The only thing marking it out is the line at the bottom saying who wrote it,
 * which is there so nobody ever mistakes a Tac-On's opinion for Eagle Bot's.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { ArrowLeft, Maximize2, PlugZap, Puzzle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppFrame } from "@/tacons/AppFrame";
import { apiGet } from "@/lib/api";
import { useDateFormat, useSession } from "@/lib/session";
import { Banner, Chip, EmptyState, LoadingPage, PageHeader } from "@/components/ui";
import { TaconViewBody, Widgets } from "@/tacons/Renderer";
import type { TaconDeskView, TaconRecordView, TaconView } from "@shared/tacons/view";

export function TaconPage({ installId, page }: { installId: number; page: string }) {
  const { studioId, can } = useSession();
  const queryClient = useQueryClient();
  // An app installed to open full screen does, until its Exit button is pressed.
  const [exitedFullWindow, setExitedFullWindow] = useState(false);
  const exitFullWindow = useCallback(() => setExitedFullWindow(true), []);
  useEffect(() => setExitedFullWindow(false), [installId, page]);

  const query = useQuery<{ view: TaconView }>({
    queryKey: ["tacon-view", installId, page, studioId],
    queryFn: () => apiGet(`/tacons/view/${installId}/${page}`),
    retry: false,
  });

  if (query.isLoading) return <LoadingPage />;

  if (query.error) {
    return (
      <EmptyState icon={Puzzle} title="This Tac-On isn't available here">
        {(query.error as Error).message}
        {can("tacons.market") && (
          <>
            {" "}
            <Link href="/tacons" className="text-brand-600 underline">
              Open the market
            </Link>
            .
          </>
        )}
      </EmptyState>
    );
  }

  const view = query.data!.view;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tacon-view", installId, page] });
  };

  return (
    <>
      <PageHeader title={view.page.title} subtitle={view.page.subtitle ?? undefined}>
        {view.install.studioName && <Chip tone="brand">{view.install.studioName}</Chip>}
        {view.install.official && <Chip tone="purple">Official</Chip>}
      </PageHeader>

      {(view.pages?.length ?? 0) > 1 && <PageTabs installId={view.install.id} current={view.page.name} pages={view.pages!} />}

      {view.app ? (
        <>
          {view.app.display === "fullscreen" && exitedFullWindow && (
            <div className="mb-3">
              <button type="button" onClick={() => setExitedFullWindow(false)} className="btn-secondary btn-sm">
                <Maximize2 className="h-4 w-4" /> Open full screen
              </button>
            </div>
          )}
          <AppFrame
            app={view.app}
            fullWindow={view.app.display === "fullscreen" && !exitedFullWindow}
            onExitFullWindow={exitFullWindow}
          />
        </>
      ) : (
        <TaconViewBody view={view} onChanged={refresh} />
      )}

      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4 text-xs text-gray-500">
        <PlugZap className="h-3.5 w-3.5" />
        <span>
          Added by the Tac-On <span className="font-medium text-gray-700">{view.install.name}</span>{" "}
          {view.install.version} — written by {view.install.authorName}.
        </span>
        {can("tacons.market") && (
          <Link href={`/tacons/${view.install.slug}`} className="text-brand-600 underline">
            Details
          </Link>
        )}
      </div>
    </>
  );
}

/**
 * The Tac-On's other pages, as tabs. Only drawn when it has more than one the
 * viewer can open, so a single-page Tac-On looks exactly as before.
 */
function PageTabs({
  installId,
  current,
  pages,
}: {
  installId: number;
  current: string;
  pages: { name: string; title: string }[];
}) {
  return (
    <nav className="scroll-x -mt-2 mb-5 border-b border-gray-200" aria-label="Pages of this Tac-On">
      <div className="flex min-w-max gap-1">
        {pages.map((page) => {
          const active = page.name === current;
          return (
            <Link
              key={page.name}
              href={`/t/${installId}/${page.name}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                active
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800"
              }`}
            >
              {page.title}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * One record on its own read-only page, opened from a list's `link` column or
 * a calendar entry. The query string says which list or calendar block it came
 * from, because that is what decides whether this person may see it.
 */
export function TaconRecordPage({ installId, recordId }: { installId: number; recordId: number }) {
  const search = useSearch();
  const { studioId } = useSession();
  const formatDate = useDateFormat();

  const query = useQuery<{ view: TaconRecordView }>({
    queryKey: ["tacon-record", installId, recordId, search, studioId],
    queryFn: () => apiGet(`/tacons/view/${installId}/record/${recordId}?${search}`),
    retry: false,
  });

  if (query.isLoading) return <LoadingPage />;
  if (query.error) {
    return (
      <EmptyState icon={Puzzle} title="This record isn't available">
        {(query.error as Error).message}
      </EmptyState>
    );
  }

  const view = query.data!.view;
  return (
    <>
      {view.back && (
        <Link href={view.back.href} className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> {view.back.label}
        </Link>
      )}
      <PageHeader title={view.title} subtitle={`A record in ${view.install.name}`}>
        {view.install.studioName && <Chip tone="brand">{view.install.studioName}</Chip>}
      </PageHeader>
      <div className="card divide-y divide-gray-100">
        {view.fields.map((field) => (
          <div key={field.key} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
            <div className="text-sm font-medium text-gray-500">{field.label}</div>
            <div className="whitespace-pre-wrap break-words text-sm text-gray-900">
              {field.type === "date" && field.value ? formatDate(field.value, false) : field.value || "—"}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4 text-xs text-gray-500">
        <PlugZap className="h-3.5 w-3.5" />
        <span>
          Kept by the Tac-On <span className="font-medium text-gray-700">{view.install.name}</span>{" "}
          {view.install.version} — written by {view.install.authorName}.
        </span>
      </div>
    </>
  );
}

/**
 * The panels Tac-Ons attach to one of Eagle Bot's own pages.
 *
 * Rendered below the page's own content and clearly labelled. A panel that
 * fails to load shows nothing at all rather than an error: the Wiki is not
 * allowed to look broken because somebody's Tac-On is.
 */
export function TaconPanels({ host }: { host: string }) {
  const { studioId, can } = useSession();
  const queryClient = useQueryClient();

  const query = useQuery<{ panels: TaconPanelData[] }>({
    queryKey: ["tacon-panels", host, studioId],
    queryFn: () => apiGet(`/tacons/panels/${host}`),
    retry: false,
    enabled: can("tacons.use"),
  });

  const panels = query.data?.panels ?? [];
  if (panels.length === 0) return null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tacon-panels", host] });
  };

  return (
    <div className="mt-8 space-y-4">
      {panels.map((panel) => (
        <div key={`${panel.installId}-${panel.title}`} className="card-pad">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900">{panel.title}</h2>
            <Chip>{panel.taconName}</Chip>
          </div>
          {panel.widgets.length === 0 ? (
            <Banner tone="info">This panel has nothing to show right now.</Banner>
          ) : (
            <Widgets
              widgets={panel.widgets}
              compact
              target={{
                installId: panel.installId,
                panel: host,
                people: panel.people,
                onChanged: refresh,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The desks of the Tac-On positions the person looking holds.
 *
 * A Tac-On that adds a position decides what its holder sees, and this is where
 * they see it: at the top of the Positions page, one card per seat. Nobody who
 * doesn't hold the position is sent a desk at all, so it renders nothing for
 * them - same as a panel that fails.
 */
export function TaconDesks() {
  const { studioId, can } = useSession();
  const queryClient = useQueryClient();

  const query = useQuery<{ desks: TaconDeskView[] }>({
    queryKey: ["tacon-desks", studioId],
    queryFn: () => apiGet("/tacons/desks"),
    retry: false,
    enabled: can("tacons.use"),
  });

  const desks = query.data?.desks ?? [];
  if (desks.length === 0) return null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tacon-desks"] });
  };

  return (
    <div className="mb-6 space-y-4">
      {desks.map((desk) => (
        <div
          key={`${desk.installId}-${desk.position}`}
          className="card-pad border-brand-200 ring-1 ring-brand-100"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-brand-700">
                Your desk
              </div>
              <h2 className="font-semibold text-gray-900">{desk.title}</h2>
            </div>
            <Chip>{desk.taconName}</Chip>
          </div>
          {desk.widgets.length === 0 ? (
            <Banner tone="info">This desk has nothing to show right now.</Banner>
          ) : (
            <Widgets
              widgets={desk.widgets}
              compact
              target={{
                installId: desk.installId,
                position: desk.position,
                people: desk.people,
                onChanged: refresh,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

type TaconPanelData = {
  installId: number;
  taconName: string;
  title: string;
  widgets: TaconView["widgets"];
  people: TaconView["people"];
};
