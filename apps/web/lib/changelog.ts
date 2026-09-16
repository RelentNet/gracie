/**
 * Gracie's release history — the single source of truth for the app's version
 * number (shown in the sidebar) and the in-app "What's New" page.
 *
 * Written for staff, not engineers: plain language, what changed for THEM.
 *
 * RELEASE CHECKLIST (one planned release at a time, so a bad one can be pinned
 * down and rolled back):
 *   1. Add a new entry at the TOP of `CHANGELOG`.
 *   2. Set the root `package.json` "version" to match (a test enforces this).
 *   3. After merging, tag `vX.Y.Z` on main and publish the GitHub release.
 */

export type ReleaseStage = 'Alpha' | 'Beta' | 'Stable';

export interface ReleaseSection {
  readonly heading: 'New' | 'Improved' | 'Fixed';
  readonly items: readonly string[];
}

export interface Release {
  /** Semver without the leading "v" (e.g. "0.4.0"). */
  readonly version: string;
  /** Release date, YYYY-MM-DD. */
  readonly date: string;
  readonly title: string;
  readonly stage: ReleaseStage;
  readonly sections: readonly ReleaseSection[];
}

/** Newest first. */
export const CHANGELOG: readonly Release[] = [
  {
    version: '0.4.0',
    date: '2026-09-16',
    title: 'Alpha — Gracie runs your meetings end to end',
    stage: 'Alpha',
    sections: [
      {
        heading: 'New',
        items: [
          'Version numbers and this What’s New page. The version in the sidebar shows a dot when something new has shipped — click it to see what changed.',
          'A page for every meeting: the recording, a transcript you can click to jump to that moment, screen-share snapshots, and the documents Gracie wrote. You can follow the transcript live while a meeting is happening.',
          'Gracie joins every meeting that has a Teams link. You can send her in yourself, ask her to leave or pause, or say “Gracie, action item…” during the call.',
          'Home is now your assistant, with today’s meetings, your tasks, and anything that needs attention at a glance.',
          'Assistant upgrades: pin chats, talk instead of typing, ask about tasks and export them to a spreadsheet, and save anything it writes straight into Documents.',
          'A redesigned Task Board, organized by client and focused on the most recent meeting. Admins can merge duplicate tasks and delete in bulk.',
          'Clients are split into Clients, Partners, Past clients and Prospective, each with its own logo and a Meetings tab.',
          'Calendar week and work-week views, the agenda beside the calendar, and times shown in your own time zone.',
          'Import contacts from Outlook (opt in from My Settings).',
          'A fresh look with light and dark mode, and your company logo in the navigation.',
          'Admins can choose which AI writes the meeting notes (OpenAI, Anthropic, Google and more).',
          'The Pipeline page shows where every meeting stands, including meetings still in progress.',
        ],
      },
      {
        heading: 'Improved',
        items: [
          'Everyone on the team can now upload documents.',
          'Meetings Gracie was never let into are labeled “Never admitted” instead of showing as errors. To get notes, admit Gracie when she asks to join.',
          'Anything marked Private in Outlook is never recorded and doesn’t appear in Gracie.',
          'If your sign-in expires, Gracie tells you right away and brings you back to the same page after you sign in again.',
          'Documents: a bigger preview (including Word, Excel and CSV files), panels you can resize, a folder created automatically for each new client, a clear Submit step when uploading, and large images shrunk automatically so they upload.',
          'The morning Daily Sync email shows tomorrow’s meetings and tidier briefs.',
          'Meeting videos are kept for six months.',
          'Admins can hide client health scores.',
        ],
      },
      {
        heading: 'Fixed',
        items: [
          'Meetings that got stuck without notes now recover on their own.',
          'Gracie skips calendar entries nobody actually attends, and staff can mark a meeting “don’t record”.',
          'Task Board buttons and client names work correctly.',
          'Generated documents no longer include leftover instruction text.',
          'Busy calendar months load reliably.',
          'Tighter sign-in checks across the app.',
        ],
      },
    ],
  },
  {
    version: '0.3.2',
    date: '2026-07-27',
    title: 'Make the morning Daily Sync your own',
    stage: 'Alpha',
    sections: [
      {
        heading: 'New',
        items: [
          'Admins can rewrite the morning Daily Sync email from Settings → Daily Sync, and optionally add an AI-written briefing built only from your own data.',
          'Send yourself a test copy before it goes to the team.',
        ],
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-07-27',
    title: 'Tune how Gracie writes your notes',
    stage: 'Alpha',
    sections: [
      {
        heading: 'New',
        items: [
          'Admins can reword how Gracie writes each meeting document from Settings → Generation Prompts, with a one-click reset.',
          'Settings is organized into tabs.',
        ],
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-21',
    title: 'Meetings now write themselves up',
    stage: 'Alpha',
    sections: [
      {
        heading: 'New',
        items: [
          'When a meeting ends, Gracie writes the full set of documents and files them under the right client automatically.',
          'Rename folders and files, choose who can see them, and restore deleted items from a 60-day recycle bin.',
        ],
      },
    ],
  },
  {
    version: '0.2.2',
    date: '2026-07-17',
    title: 'Meeting documents, organized',
    stage: 'Alpha',
    sections: [
      {
        heading: 'Fixed',
        items: [
          'Two meetings on the same day no longer overwrite each other’s documents, and late-evening meetings are filed on the right day.',
          'A recurring meeting’s documents are grouped together, with a dated folder for each occurrence.',
        ],
      },
    ],
  },
  {
    version: '0.2.1',
    date: '2026-07-03',
    title: 'Upload where you’re looking',
    stage: 'Alpha',
    sections: [
      {
        heading: 'Improved',
        items: [
          'Uploads land in the folder you’re viewing, and the folder tree collapses.',
        ],
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-07-03',
    title: 'Documents becomes a real drive',
    stage: 'Alpha',
    sections: [
      {
        heading: 'New',
        items: [
          'Upload files, create folders, move documents, and browse every client’s documents in one place.',
        ],
      },
    ],
  },
];

/** The version the app is running (the newest changelog entry). */
export const CURRENT_RELEASE: Release = CHANGELOG[0]!;
