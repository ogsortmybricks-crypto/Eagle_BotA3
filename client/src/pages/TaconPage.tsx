/**
 * A page an installed Tac-On added.
 *
 * It sits inside the normal layout, under the normal sidebar, tinted with the
 * academy's own palette - a Tac-On is part of the app, not a frame inside it.
 * The only thing marking it out is the line at the bottom saying who wrote it,
 * which is there so nobody ever mistakes a Tac-On's opinion for Eagle Bot's.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PlugZap, Puzzle } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Banner, Chip, EmptyState, LoadingPage, PageHeader } from "@/components/ui";
import { TaconViewBody, Widgets } from "@/tacons/Renderer";
import type { TaconView } from "@shared/tacons/view";

export function TaconPage({ installId, page }: { installId: number; page: string }) {
  const { studioId, can } = useSession();
  const queryClient = useQueryClient();

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

      <TaconViewBody view={view} onChanged={refresh} />

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

type TaconPanelData = {
  installId: number;
  taconName: string;
  title: string;
  widgets: TaconView["widgets"];
  people: TaconView["people"];
};
