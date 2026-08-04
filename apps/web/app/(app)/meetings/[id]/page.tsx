import { ArrowLeft, CalendarClock, CheckSquare, FileText, ScrollText, Video } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Document, MasterRecordEntry, Meeting, Role, Task } from '@gracie/shared';

import { FileList } from '@/components/FileBrowser/FileList';
import { LiveTranscript } from '@/components/meetings/LiveTranscript';
import { MeetingRecording } from '@/components/meetings/MeetingRecording';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { PageContainer } from '@/components/ui/PageContainer';
import { EmptyState } from '@/components/ui/StateViews';
import { taskStatusLabel } from '@/lib/client-display';
import { getClient } from '@/lib/data/clients';
import { getClientMeetings } from '@/lib/data/client-detail';
import { filterVisibleDocuments, filterVisibleFolders, listFolders } from '@/lib/data/documents';
import {
  getLatestPipelineRun,
  getMeetingById,
  getMeetingDocuments,
  getMeetingMasterRecord,
  getMeetingMedia,
  getMeetingTasks,
  resolveMeetingPlayback,
  type MeetingPlayback,
} from '@/lib/data/meeting-occurrence';
import { formatEasternDate, formatEasternDateTime } from '@/lib/format';
import {
  deriveMeetingFleetState,
  deriveOccurrenceState,
  selectPriorMeetings,
  type OccurrenceState,
} from '@/lib/meeting-occurrence';
import { describePipelineState } from '@/lib/pipeline-reason';
import { getCurrentUser } from '@/lib/server-auth';
import { TYPE } from '@/lib/typography';

/** Plain-language chip for the occurrence state (never a raw pipeline enum). */
function StateChip({ state }: { readonly state: OccurrenceState }): React.JSX.Element {
  const map: Record<OccurrenceState, { label: string; bg: string; fg: string }> = {
    upcoming: { label: 'Upcoming', bg: 'var(--color-blue-100)', fg: 'var(--color-blue-700)' },
    in_session: { label: 'In session', bg: '#dcfce7', fg: '#166534' },
    ended: { label: 'Recorded', bg: 'var(--color-slate-100)', fg: 'var(--color-slate-600)' },
  };
  const s = map[state];
  return (
    <Badge bg={s.bg} fg={s.fg}>
      {s.label}
    </Badge>
  );
}

/** One prior-meeting link (the "last 3 summaries" cockpit). */
function PriorMeetingLink({ meeting }: { readonly meeting: Meeting }): React.JSX.Element {
  return (
    <Link
      href={`/meetings/${meeting.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:underline"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <span className="flex min-w-0 flex-col">
        <span style={TYPE.bodyStrong} className="truncate">
          {meeting.title ?? 'Untitled meeting'}
        </span>
        <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          {formatEasternDate(meeting.dateTime)}
        </span>
      </span>
      <span style={{ ...TYPE.label, color: 'var(--color-blue-600)' }}>View summary →</span>
    </Link>
  );
}

/** The "recent history" card, shared by the upcoming and in-session states. */
function RecentHistory({ prior }: { readonly prior: readonly Meeting[] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader
        title="Recent history"
        description="This client's last few meetings — open one for its summary and follow-ups."
        icon={<ScrollText size={20} aria-hidden="true" />}
      />
      {prior.length > 0 ? (
        <div className="flex flex-col gap-2">
          {prior.map((m) => (
            <PriorMeetingLink key={m.id} meeting={m} />
          ))}
        </div>
      ) : (
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>No prior meeting on file.</p>
      )}
    </Card>
  );
}

/** Follow-up tasks extracted from this meeting. */
function TasksCard({ tasks }: { readonly tasks: readonly Task[] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Follow-up tasks" icon={<CheckSquare size={20} aria-hidden="true" />} />
      {tasks.length > 0 ? (
        <ul>
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 border-b py-2 last:border-0"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <span style={TYPE.body} className="min-w-0">
                {t.description}
              </span>
              <span className="flex flex-shrink-0 items-center gap-2">
                {t.dueDate !== null ? (
                  <span style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
                    due {formatEasternDate(`${t.dueDate}T12:00:00Z`)}
                  </span>
                ) : null}
                <Badge bg="var(--color-slate-100)" fg="var(--color-slate-600)">
                  {taskStatusLabel(t.status)}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          No follow-up tasks were extracted from this meeting.
        </p>
      )}
    </Card>
  );
}

/** The master-record chronology entry written for this meeting. */
function MasterRecordCard({ entries }: { readonly entries: readonly MasterRecordEntry[] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader
        title="Master record"
        description="What this meeting added to the client's running history."
        icon={<FileText size={20} aria-hidden="true" />}
      />
      {entries.length > 0 ? (
        <div className="flex flex-col gap-3">
          {entries.map((e) => (
            <p key={e.id} style={TYPE.body} className="whitespace-pre-wrap">
              {e.summary}
            </p>
          ))}
        </div>
      ) : (
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          No master-record entry for this meeting yet.
        </p>
      )}
    </Card>
  );
}

/**
 * Ended-state pipeline status panel. The plain-language `headline` is what a
 * non-technical staffer reads; any raw provider/error text is tucked behind a
 * native `<details>` expander (the operator's "debug info here so it's easy to
 * fix"), never shown as the headline.
 */
function PipelineStatusPanel({
  headline,
  detail,
  action,
}: {
  readonly headline: string;
  readonly detail: string | null;
  /** Optional call-to-action rendered under the headline (e.g. "Link a client"). */
  readonly action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Document generation" />
      <p style={TYPE.body}>{headline}</p>
      {action !== undefined ? <div className="mt-3">{action}</div> : null}
      {detail !== null ? (
        <details className="mt-3">
          <summary style={{ ...TYPE.label, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Debug details (for support)
          </summary>
          <pre
            className="mt-2 overflow-x-auto rounded-md border p-2 font-data"
            style={{ ...TYPE.label, borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            {detail}
          </pre>
        </details>
      ) : null}
    </Card>
  );
}

/** Documents generated for this occurrence, already filtered for the caller's role. */
function DocumentsCard({ documents }: { readonly documents: readonly Document[] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader title="Documents" description="Everything Gracie generated from this meeting." />
      {documents.length > 0 ? (
        <FileList documents={documents} canEdit={false} />
      ) : (
        <EmptyState
          title="No documents"
          description="No documents have been generated for this meeting."
        />
      )}
    </Card>
  );
}

/**
 * Recorded meeting player (ended-state). The video is live-pulled from Recall on view
 * and streamed DIRECTLY from Recall's S3 (never stored on our infra, never proxied);
 * the transcript segments are resolved server-side (our durable copy, or a
 * live-pull-and-cache for back-catalog meetings). A meeting that never had a bot shows
 * nothing; a meeting whose recording is gone (retention lapsed / never made) shows a
 * plain-language "no longer available" note.
 */
function RecordingCard({
  playback,
  hasBot,
}: {
  readonly playback: MeetingPlayback | null;
  readonly hasBot: boolean;
}): React.JSX.Element | null {
  if (!hasBot) return null;
  if (playback === null || playback.videoUrl === null) {
    return (
      <Card>
        <CardHeader title="Recording" icon={<Video size={20} aria-hidden="true" />} />
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          The recording is no longer available.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title="Recording"
        description="Play the meeting and click any line to jump to that moment."
        icon={<Video size={20} aria-hidden="true" />}
      />
      <MeetingRecording videoUrl={playback.videoUrl} segments={playback.segments} />
    </Card>
  );
}

/** Content for a meeting that has ended / been recorded. */
async function EndedView({ meeting, role }: { readonly meeting: Meeting; readonly role: Role }): Promise<React.JSX.Element> {
  const [rawDocs, allFolders, tasks, masterRecord, run, media] = await Promise.all([
    getMeetingDocuments(meeting.id),
    listFolders(),
    getMeetingTasks(meeting.id),
    getMeetingMasterRecord(meeting.id),
    getLatestPipelineRun(meeting.id),
    getMeetingMedia(meeting.id),
  ]);

  // ACCESS CONTROL: same rule as the Documents area — hide restricted folders/docs
  // (e.g. the admin-only Transcripts folder) via the shared resolver before anything
  // reaches a non-admin (docs/plan §4.4, D14).
  const visibleFolders = filterVisibleFolders(allFolders, role);
  const documents = filterVisibleDocuments(rawDocs, visibleFolders, role);

  const fleetState = deriveMeetingFleetState({
    hasRun: run !== null,
    runStatus: run?.runStatus ?? null,
    pipelineStatus: meeting.pipelineStatus,
  });
  const hasRecording = meeting.botJobId !== null && meeting.botJobId !== '';
  const reason = describePipelineState({ state: fleetState, errorMessage: run?.errorMessage, hasRecording });

  // Recorded-but-unlinked: the transcript is captured but there's no client to file
  // notes under. Offer the link action right here (linking a client auto-generates
  // the notes — see maybeGenerateOnLink). Linking lives on the Calendar meeting card.
  const needsClientLink = meeting.clientId === null && documents.length === 0;
  const linkAction = needsClientLink ? (
    <Link
      href="/calendar"
      className="inline-flex w-fit items-center gap-1"
      style={{ ...TYPE.label, color: 'var(--color-blue-600)' }}
    >
      Link a client on the Calendar →
    </Link>
  ) : undefined;

  // Assemble the player on view: a FRESH Recall video URL (streamed directly, never
  // stored) + transcript segments (our durable copy, else live-pull-and-cache). The
  // page is already authenticated-staff gated; the transcript's folder ACL is enforced
  // inside resolveMeetingPlayback.
  const playback = hasRecording ? await resolveMeetingPlayback(meeting, media, role) : null;

  return (
    <>
      <RecordingCard playback={playback} hasBot={hasRecording} />
      <PipelineStatusPanel headline={reason.headline} detail={reason.detail} action={linkAction} />
      <DocumentsCard documents={documents} />
      <TasksCard tasks={tasks} />
      <MasterRecordCard entries={masterRecord} />
    </>
  );
}

/** Content for an upcoming or in-session meeting (prep material + a live indicator). */
async function PrepView({
  meeting,
  inSession,
}: {
  readonly meeting: Meeting;
  readonly inSession: boolean;
}): Promise<React.JSX.Element> {
  const clientMeetings = meeting.clientId !== null ? await getClientMeetings(meeting.clientId) : [];
  const prior = selectPriorMeetings(clientMeetings, meeting.id, meeting.dateTime, 3);

  return (
    <>
      {inSession ? (
        <Card accent="critical">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: 'var(--color-red-500)' }}
            />
            <span style={TYPE.bodyStrong}>Recording now</span>
          </div>
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }} className="mt-1">
            This meeting is within its scheduled time and a Gracie bot was dispatched. Documents appear
            here once it ends.
          </p>
          <LiveTranscript meetingId={meeting.id} />
        </Card>
      ) : null}
      <RecentHistory prior={prior} />
    </>
  );
}

/**
 * Meeting-occurrence page (`/meetings/[id]`, Phase A — docs/plan
 * meeting-occurrence-page). Status-adaptive: upcoming / in-session show prep
 * material; ended shows the generated documents, tasks, master record and a
 * plain-language pipeline status. Restricted content is filtered per the
 * Documents-area rules. Later phases (live status B, video C, live transcript D,
 * live video E) are deferred.
 */
export default async function MeetingOccurrencePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const [meeting, user] = await Promise.all([getMeetingById(id), getCurrentUser()]);
  if (meeting === null) notFound();

  const state = deriveOccurrenceState(meeting);
  const client = meeting.clientId !== null ? await getClient(meeting.clientId) : null;

  const who = meeting.isInternal ? 'Internal' : (client?.name ?? 'Unassigned');
  const durationLabel =
    meeting.durationMinutes !== null ? ` · ${meeting.durationMinutes} min` : '';

  return (
    <PageContainer className="flex flex-col gap-6">
      <Link
        href="/calendar"
        className="inline-flex w-fit items-center gap-1"
        style={{ ...TYPE.label, color: 'var(--color-blue-600)' }}
      >
        <ArrowLeft size={14} aria-hidden="true" /> Calendar
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 style={TYPE.pageTitle}>{meeting.title ?? 'Untitled meeting'}</h1>
          <StateChip state={state} />
        </div>
        <p
          className="flex flex-wrap items-center gap-1.5"
          style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}
        >
          <CalendarClock size={15} aria-hidden="true" />
          {formatEasternDateTime(meeting.dateTime)}
          {durationLabel}
          {' · '}
          {client !== null ? (
            <Link href={`/clients/${client.id}`} style={{ color: 'var(--color-blue-600)' }}>
              {who}
            </Link>
          ) : (
            who
          )}
        </p>
        {meeting.videoLink !== null && state !== 'ended' ? (
          <a
            href={meeting.videoLink}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex w-fit items-center gap-1"
            style={{ ...TYPE.label, color: 'var(--color-blue-600)' }}
          >
            <Video size={14} aria-hidden="true" /> Join link
          </a>
        ) : null}
      </header>

      {state === 'ended' ? (
        <EndedView meeting={meeting} role={user.role} />
      ) : (
        <PrepView meeting={meeting} inSession={state === 'in_session'} />
      )}
    </PageContainer>
  );
}
