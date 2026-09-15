import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckSquare, Gavel, Plus } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useDateFormat, useSession } from "@/lib/session";
import { Banner, Chip, EmptyState, LoadingPage, Modal, PageHeader, Spinner } from "@/components/ui";
import { StudioTag } from "@/components/StudioSwitcher";
import { StudioPicker } from "@/components/StudioPicker";

type MeetingRow = {
  meeting: {
    id: number;
    title: string;
    meetingDate: string;
    status: string;
    studioId: number | null;
    processedAt: string | null;
  };
  secretaryName: string | null;
  studioName: string | null;
  studioColor: string | null;
  itemCount: number;
};

type ActionItem = {
  item: { id: number; title: string; dueDate: string | null; body: string };
  meetingTitle: string;
  meetingDate: string;
  studioName: string | null;
  assigneeName: string | null;
};

const STATUS_TONE: Record<string, "neutral" | "brand" | "amber" | "green"> = {
  draft: "neutral",
  in_progress: "brand",
  processing: "amber",
  processed: "green",
  archived: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_progress: "In session",
  processing: "AI is reading",
  processed: "In the wiki",
  archived: "Archived",
};

export function TownHall() {
  const { can, studio, studioId, settings } = useSession();
  const formatDate = useDateFormat();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [targetStudio, setTargetStudio] = useState<number | null | undefined>(
    studioId === null ? undefined : studioId,
  );
  const [error, setError] = useState<string | null>(null);

  const meetings = useQuery<{ meetings: MeetingRow[] }>({
    queryKey: ["meetings", studioId],
    queryFn: () => apiGet("/town-hall"),
  });

  const openItems = useQuery<{ items: ActionItem[] }>({
    queryKey: ["open-action-items", studioId],
    queryFn: () => apiGet("/town-hall/action-items/open"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost<{ meeting: { id: number } }>("/town-hall", {
        title: title.trim(),
        ...(targetStudio === undefined ? {} : { studioId: targetStudio }),
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["meetings"] });
      window.location.href = `/town-hall/${data.meeting.id}`;
    },
    onError: (createError: Error) => setError(createError.message),
  });

  /** The academy's title template, with the date and studio filled in. */
  function defaultTitle() {
    const name =
      targetStudio === undefined || targetStudio === null
        ? (studio?.name ?? "Academy")
        : "";
    return settings.townHall.titleTemplate
      .replace(
        "{date}",
        new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" }),
      )
      .replace("{studio}", name || (studio?.name ?? "Academy"));
  }

  if (meetings.isLoading) return <LoadingPage />;

  const rows = meetings.data?.meetings ?? [];
  const pending = openItems.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={studio ? `${studio.name} — Town Hall` : "Town Hall"}
        subtitle={
          studio
            ? `Every ${studio.name} governance meeting, and what came out of it.`
            : "Every governance meeting across the academy. Each belongs to the studio that held it."
        }
      >
        {can("meetings.write") && (
          <button
            onClick={() => {
              setTitle(defaultTitle());
              setCreating(true);
            }}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" /> New meeting
          </button>
        )}
      </PageHeader>

      {pending.length > 0 && (
        <div className="card mb-5">
          <div className="flex items-center gap-2.5 border-b border-gray-200 p-4">
            <CheckSquare className="h-4 w-4 text-brand-600" />
            <h2 className="text-sm font-semibold text-gray-900">
              {pending.length} action item{pending.length === 1 ? "" : "s"} still open
            </h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {pending.map(({ item, meetingTitle, studioName, assigneeName }) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3.5 text-sm">
                <span className="font-medium text-gray-900">{item.title}</span>
                {assigneeName && <Chip tone="brand">{assigneeName}</Chip>}
                {item.dueDate && (
                  <Chip tone={new Date(item.dueDate) < new Date() ? "red" : "neutral"}>
                    due {formatDate(item.dueDate)}
                  </Chip>
                )}
                <span className="text-xs text-gray-400">
                  from {meetingTitle}
                  {studioId === null && studioName ? ` · ${studioName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="No Town Halls recorded yet"
          action={
            can("meetings.write") ? (
              <button
                onClick={() => {
                  setTitle(defaultTitle());
                  setCreating(true);
                }}
                className="btn-primary"
              >
                <Plus className="h-4 w-4" /> Start one
              </button>
            ) : undefined
          }
        >
          When the studio meets, the secretary takes notes here. When the meeting ends, one button
          folds every decision into the wiki and strikes out whatever it contradicts.
        </EmptyState>
      ) : (
        <div className="card divide-y divide-gray-100">
          {rows.map(({ meeting, secretaryName, studioName, studioColor, itemCount }) => (
            <Link
              key={meeting.id}
              href={`/town-hall/${meeting.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 p-4 transition hover:bg-gray-50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-900">{meeting.title}</span>
                  <Chip tone={STATUS_TONE[meeting.status] ?? "neutral"}>
                    {STATUS_LABEL[meeting.status] ?? meeting.status}
                  </Chip>
                  {(studioId === null || meeting.studioId === null) && (
                    <StudioTag
                      name={studioName}
                      color={studioColor}
                      shared={meeting.studioId === null}
                    />
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {formatDate(meeting.meetingDate)}
                  </span>
                  <span>
                    {itemCount} item{itemCount === 1 ? "" : "s"}
                  </span>
                  {secretaryName && <span>notes by {secretaryName}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Start a Town Hall"
        description={
          settings.townHall.carryOverActionItems
            ? "Open action items from this studio's last meeting come along automatically."
            : "A blank meeting. This academy doesn't carry action items forward."
        }
        footer={
          <>
            <button onClick={() => setCreating(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => create.mutate()}
              disabled={
                create.isPending || title.trim().length < 2 || targetStudio === undefined
              }
              className="btn-primary"
            >
              {create.isPending && <Spinner />} Open the workspace
            </button>
          </>
        }
      >
        {error && (
          <div className="mb-4">
            <Banner tone="error">{error}</Banner>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="meeting-title">
              What's this meeting called?
            </label>
            <input
              id="meeting-title"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </div>
          <StudioPicker
            value={targetStudio}
            onChange={setTargetStudio}
            label="Which studio is meeting?"
            hint="The notes, the attendance list and everything the AI writes afterwards stay with this studio."
          />
        </div>
      </Modal>
    </>
  );
}
