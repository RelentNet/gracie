/**
 * GET /api/meetings/:id — everything the meeting-occurrence page shows.
 *
 * - `meeting` + `client` ({id, name} only — never the admin-only client fields).
 * - `ended`: for a meeting that has ended, its documents (filtered by the Documents
 *   area's folder ACL for the caller's role), tasks, master record, latest pipeline
 *   run, stills and playback (fresh Recall video URL + transcript segments).
 * - `prior`: otherwise, the client's last 3 meetings before this one.
 */
import { NextResponse } from 'next/server';

import { requireRequestUser } from '@/lib/api-auth';
import { getClient } from '@/lib/data/clients';
import { getClientMeetings } from '@/lib/data/client-detail';
import { filterVisibleDocuments, filterVisibleFolders, listFolders } from '@/lib/data/documents';
import {
  getLatestPipelineRun,
  getMeetingById,
  getMeetingDocuments,
  getMeetingMasterRecord,
  getMeetingMedia,
  getMeetingStills,
  getMeetingTasks,
  resolveMeetingPlayback,
} from '@/lib/data/meeting-occurrence';
import { deriveOccurrenceState, selectPriorMeetings } from '@/lib/meeting-occurrence';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const authed = await requireRequestUser();
  if (authed instanceof NextResponse) return authed;
  const { role } = authed;
  try {
    const { id } = await params;
    const meeting = await getMeetingById(id);
    if (meeting === null) {
      return NextResponse.json(
        { error: { code: 'meeting_not_found', message: 'Meeting not found' } },
        { status: 404 },
      );
    }
    const client = meeting.clientId !== null ? await getClient(meeting.clientId) : null;
    const clientRef = client !== null ? { id: client.id, name: client.name } : null;

    if (deriveOccurrenceState(meeting) !== 'ended') {
      const clientMeetings =
        meeting.clientId !== null ? await getClientMeetings(meeting.clientId) : [];
      const prior = selectPriorMeetings(clientMeetings, meeting.id, meeting.dateTime, 3);
      return NextResponse.json({ meeting, client: clientRef, ended: null, prior });
    }

    const [rawDocs, allFolders, tasks, masterRecord, run, media, stills] = await Promise.all([
      getMeetingDocuments(meeting.id),
      listFolders(),
      getMeetingTasks(meeting.id),
      getMeetingMasterRecord(meeting.id),
      getLatestPipelineRun(meeting.id),
      getMeetingMedia(meeting.id),
      getMeetingStills(meeting.id, role),
    ]);
    // ACCESS CONTROL: same rule as the Documents area — hide restricted folders/docs
    // (e.g. the admin-only Transcripts folder) before anything reaches a non-admin.
    const documents = filterVisibleDocuments(rawDocs, filterVisibleFolders(allFolders, role), role);
    const hasRecording = meeting.botJobId !== null && meeting.botJobId !== '';
    // Transcript folder ACL is enforced inside resolveMeetingPlayback.
    const playback = hasRecording ? await resolveMeetingPlayback(meeting, media, role) : null;

    return NextResponse.json({
      meeting,
      client: clientRef,
      ended: { documents, tasks, masterRecord, run, stills, playback },
      prior: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'meeting_failed', message } }, { status: 500 });
  }
}
