/**
 * A dev's global profile.
 *
 * The profile page in People belongs to a person's academy: their studio, their
 * positions, their Contract. This one belongs to them. It is the page a learner
 * can point at from outside - home academy, what they're building toward, and
 * the Tac-Ons they've shipped with the number of academies running each.
 */

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Code2, Download, MapPin, Puzzle, Rocket } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useDateFormat } from "@/lib/session";
import { Avatar, Chip, EmptyState, LoadingPage, Stat } from "@/components/ui";

type DevProfileData = {
  dev: {
    handle: string;
    name: string;
    bio: string | null;
    avatarUrl: string | null;
    nga: string | null;
    devSince: string | null;
    active: boolean;
    homeStudio: string | null;
  };
  tacons: {
    slug: string;
    name: string;
    tagline: string | null;
    installCount: number;
    version: string | null;
  }[];
  totals: { published: number; installs: number };
};

export function DevProfile({ handle }: { handle: string }) {
  const formatDate = useDateFormat();
  const query = useQuery<DevProfileData>({
    queryKey: ["dev-profile", handle],
    queryFn: () => apiGet(`/tacons/devs/${handle}`),
    retry: false,
  });

  if (query.isLoading) return <LoadingPage />;
  if (query.error) {
    return (
      <EmptyState icon={Code2} title="No dev by that handle">
        {(query.error as Error).message}
      </EmptyState>
    );
  }

  const { dev, tacons, totals } = query.data!;

  return (
    <>
      <div className="card-pad">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar name={dev.name} src={dev.avatarUrl} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">{dev.name}</h1>
              <Chip tone={dev.active ? "brand" : "neutral"}>
                <Code2 className="h-3 w-3" /> {dev.active ? "Dev" : "Former dev"}
              </Chip>
            </div>
            <p className="text-sm text-gray-500">@{dev.handle}</p>

            <div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-600">
              {dev.homeStudio && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> {dev.homeStudio}
                </span>
              )}
              {dev.devSince && (
                <span className="inline-flex items-center gap-1.5">
                  <Rocket className="h-3.5 w-3.5" /> building since {formatDate(dev.devSince)}
                </span>
              )}
            </div>

            {dev.bio && <p className="mt-3 text-sm text-gray-700">{dev.bio}</p>}

            {dev.nga && (
              <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                  Next Great Adventure
                </div>
                <p className="mt-1 text-sm text-gray-700">{dev.nga}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:max-w-sm">
        <Stat label="Published" value={totals.published} />
        <Stat label="Installs" value={totals.installs} tone="good" />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-bold text-gray-900">Tac-Ons</h2>
      {tacons.length === 0 ? (
        <EmptyState icon={Puzzle} title="Nothing public yet">
          Drafts and unlisted Tac-Ons don't show up here.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tacons.map((tacon) => (
            <Link
              key={tacon.slug}
              href={`/tacons/${tacon.slug}`}
              className="card p-4 transition hover:border-brand-300 hover:shadow"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate font-semibold text-gray-900">{tacon.name}</h3>
                <Chip>
                  <Download className="h-3 w-3" /> {tacon.installCount}
                </Chip>
              </div>
              <p className="mt-1.5 text-sm text-gray-600">{tacon.tagline}</p>
              <p className="mt-2 text-xs text-gray-400">{tacon.version}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
