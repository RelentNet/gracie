# Grace & Associates Meeting Intelligence System - Complete Specification

## Project Overview

Grace & Associates Meeting Intelligence System is an internal tool for an 8-person federal healthcare IT consulting firm managing approximately 30 active clients. The system processes meeting transcripts, generates AI-powered documents, tracks client relationships, and provides strategic intelligence for account management.

---

## Technical Stack

- **Framework**: React 18 + TypeScript
- **Styling**: Tailwind CSS v4
- **Typography**: IBM Plex Sans (400, 500, 600, 700) and IBM Plex Mono (400, 500)
- **Icons**: Lucide React
- **Authentication**: Logto + Microsoft SSO
- **Backend (planned)**: 
  - ChatGPT API for document generation
  - Otter.ai API for transcript ingestion
  - Supabase Vector DB for meeting history
  - Google Drive API for document storage
  - Microsoft Graph API for calendar integration

---

## Design System

### Colors

- **Navy** (`#0f172a`, `#1e293b`) - Sidebar background, primary dark text
- **Blue** (`#3b82f6`, `#1e40af`, `#dbeafe`) - Primary actions, links, in-progress states
- **Emerald** (`#10b981`, `#059669`, `#d1fae5`) - Success, completion, positive states
- **Amber** (`#f59e0b`, `#d97706`, `#fef3c7`) - Warnings, alerts, 48-hour task flags
- **Red** (`#ef4444`, `#dc2626`, `#fee2e2`) - Overdue, critical, admin-only indicators
- **Slate** (`#64748b`, `#475569`, `#f1f5f9`) - Secondary text, inactive states, backgrounds

### Typography

- **Headings**: IBM Plex Sans, weights 600-700
- **Body Text**: IBM Plex Sans, weights 400-500
- **Code/Data**: IBM Plex Mono, weights 400-500
- No font size, font weight, or line-height Tailwind classes used (inline styles instead)

### Design Principles

- Compact data density - power-user internal tool aesthetic
- Professional federal consulting visual language
- Admin-only fields marked with red left border or lock icon
- Restricted content completely hidden from unauthorized users (not just locked)
- All timestamps in Eastern time
- No auto-send of client-facing documents
- Authentication via Logto + Microsoft SSO only

---

## Three-Tier Role System

### Admin
- Full access to everything
- Sees Finance tab on client profiles
- Sees Transcripts folder in file browsers
- Can access Settings page
- Can view pipeline error logs
- Red labels/lock icons on admin-only fields
- Navy badge: "Admin"

### Standard User
- Full working access, no restricted content
- Cannot see Finance tab
- Cannot see Transcripts folder (hidden completely)
- Cannot access Settings
- No role badge displayed

### Viewer
- Read-only access across the entire system
- All action buttons hidden or disabled (Upload, Create Folder, Move, Edit, Add Note)
- Can only "Mark Complete" on tasks explicitly assigned to them
- All content visible except restricted folders/tabs
- Amber badge: "Viewer"

---

## Application Structure

### Main Navigation (Sidebar)

1. **Overview** (Dashboard) - Daily command center
2. **Clients** - Client list and profiles
3. **Pipeline** - Meeting processing status
4. **Documents** - Global file browser across all clients
5. **Task Board** - Task management across all clients
6. **Calendar** - Meeting calendar with day view
7. **Daily Sync** - Auto-generated daily briefing
8. **Knowledge Base** - Global intelligence library
9. **Settings** (Admin only) - System configuration

### Sidebar Bottom Section
- User avatar with initials
- User name
- Role badge (Admin navy, Viewer amber)
- Calendar connection indicator (green dot)
- Sign Out button

---

## Core Features

### 1. Login Screen

**Layout**:
- Full-page centered card
- Grace & Associates logo (GA wordmark in blue gradient box)
- Headline: "Grace & Associates"
- Subtitle: "Meeting Intelligence Platform"
- Single "Sign in with Microsoft" button (Microsoft logo + styling)
- Footer: "Access is restricted to authorized Grace & Associates team members"
- Background: Dark navy gradient

**Behavior**:
- Triggers Logto Microsoft SSO flow
- First login shows "Setting up your account..." loading state
- Redirects to Dashboard after authentication

---

### 2. Dashboard (Overview)

**Header**:
- Title: "Daily Command Center"
- Current date (Thursday, April 24, 2026)
- Upload button (hidden for Viewers)

**Alert Cards**:
- Daily Sync banner (blue gradient): "Today's Daily Sync Available" with meeting/task summary
- Knowledge Base expiration alert (amber): Shows when documents expiring within 14 days

**Metrics Cards** (3-column grid):
- Today's Meetings (count + breakdown)
- Active Clients (count + weekly meetings)
- Tasks Due Today (count + status, amber background)

**Two-Column Content**:
- **Left**: Today's Meeting Pipeline
  - Meeting cards with client avatar, title, time, status badge, document pills
  - Status badges: Scheduled, Processing, Complete, Needs Review
  
- **Right**: Priority Tasks
  - Task cards with title, client, status, due date, owner
  - Status badges match meeting statuses

**Viewer Experience**:
- Upload button hidden
- All action buttons replaced with read-only indicators
- "Mark Complete" visible only on assigned tasks

---

### 3. Clients List

**Grid View** of client cards showing:
- Client avatar (colored circle with initials)
- Client name
- Contract number
- Fee tier indicator (🟢 High / 🟡 Mid / 🔵 Standard)
- Billing cadence
- Relationship health score (with color: >90% emerald, 70-90% amber, <70% red)
- Last meeting date
- Click to open Client Detail

**Clients**:
- CMS Data Analytics
- VA Modernization
- HHS Integration Project
- FDA Reporting Portal
- CDC Emergency Response
- (and ~25 more)

---

### 4. Client Profile (7 Tabs)

**Header**:
- Back to Clients button
- Client avatar + name
- Contract number + primary contact
- Upload button (Viewer: hidden)
- Settings gear icon

**Tabs** (with icons):

#### Tab 1: Overview (Default)
- **Relationship Health Score**: 95% (emerald gradient card with TrendingUp icon)
- **Last Meeting Snapshot**: Date, type, summary
- **Top 3 Open Tasks**: Status badges, owners, due dates
- **Client Description**: Editable text block with "View Master Record" button
- **Google Drive Folder**: Quick-link with "Open in Drive" button

#### Tab 2: Strategy
- **Relationship Trajectory**: Improving/Stable/Declining indicator (colored card with icon)
- **Meeting Frequency Trend**: Cadence, last meeting, next expected
- **Risk Flags**: Red alert card with warning icons
- **MASTER_RECORD Chronology**: 3 most recent meeting summaries with "View Full Record" button
- **Admin Notes**: Editable field with context about client importance

#### Tab 3: Finance (Admin Only)
- **Fee Tier**: Large card with emoji indicator (🟢 High Tier)
- **Contract Value**: Dollar amount with 🔒 lock icon and "Admin-sensitive data" badge
- **Billing Cadence**: Monthly/Quarterly with 🔒 lock icon
- **Task Completion Rate**: Progress bar showing 92% with metrics
- **Time Spent vs Revenue**: Hours/revenue this month with efficiency rating
- **Note**: "Financial data marked with 🔒 is visible to all users but considered admin-sensitive"

#### Tab 4: Operations
- **Task Board**: Full table (Status, Task, Owner, Due Date, Priority)
  - Priority badges (HIGH red, MEDIUM amber, LOW blue)
- **Pipeline Run History**: Card showing recent processing runs with document counts
- **Transcript History**: Card showing uploaded transcripts with source badges (Otter.ai blue, Manual Upload purple)

#### Tab 5: Notes
- **Compose Area** (top): Textarea with "Post Note" button (Send icon)
- **Team Notes Feed**: Chronological cards with:
  - Colored author chips with initials
  - Author name + timestamp ("2 hours ago", "1 day ago")
  - Note content
  - Edit/Delete buttons (own notes only)

#### Tab 6: Documents (Two-Panel File Browser)

**Left Panel - Folder Tree**:
```
📁 Generated Docs
   📁 2026-05-01
   📁 2026-04-28
📁 Uploads
   📁 Proposals
   📁 Capability Decks
   📁 Email Threads
📁 Pre-Meeting Briefs
🔒 Transcripts (Admin only - completely hidden from others)
```
- New Folder button (canEdit users)
- Expandable/collapsible folders
- Selected folder highlighted in blue

**Right Panel - File List**:
- Breadcrumb navigation (Home > folder path)
- "Upload Here" button (canEdit users)
- Table columns: Name, Type, Date, Uploaded By, Size, Status
- Type badges: Meeting (blue), Upload (purple), Auto (emerald)
- Status badges: Ready (emerald), Requires Review (amber), Delivered (blue)
- Action icons: Download, Move, More menu (canEdit users)

**Restricted Folder Behavior**:
- Admin sees 🔒 icon on Transcripts folder
- Standard Users and Viewers: folder doesn't exist in their view at all
- Custom folders can be marked Restricted (Admin only setting)

#### Tab 7: Intelligence

**Scope Indicator Bar** (blue background):
- Sparkles icon + "Scoped to [Client Name]"
- "Pulling from all meetings, documents, and uploads for this client"
- "Online Research" toggle button (ON: blue bg, OFF: white bg with border)

**Chat Interface**:
- **Left-aligned**: Claude responses in slate-100 background with Sparkles icon + "Claude" label
  - Supports **bold** markdown rendering
- **Right-aligned**: User messages in blue-600 background
- Message bubbles with max-width 3xl, rounded corners, padding

**Input Area**:
- Textarea (3 rows) with placeholder "Ask about [Client Name]..."
- Send button (blue-600 bg, disabled when empty)
- Helper text: "Press Enter to send, Shift+Enter for new line"

---

### 5. Global Documents Area

**Two-Panel Layout** (matches client Documents tab):

**Left Panel - Folder Tree**:
```
📁 All Clients
   📁 CMS Data Analytics
   📁 VA Modernization
   📁 HHS Integration Project
   📁 FDA Reporting Portal
   📁 CDC Emergency Response
📁 Recent Documents
📂 Knowledge Base → (links to Knowledge Base page with ExternalLink icon)
```

**Right Panel - File List**:
- Breadcrumb navigation
- Upload button in header (canEdit users)
- Table with columns: Name, Client, Type, Date, Uploaded By, Size, Status
- Same badge styling as client file browser
- Action icons: Download, Move, More (canEdit users)

**Knowledge Base Link**:
- BookOpen icon in blue
- Clicking navigates to Knowledge Base page
- Shows ExternalLink icon to indicate navigation

---

### 6. Knowledge Base

**Header**:
- BookOpen icon + "Knowledge Base" title
- Subtitle: "Global intelligence library — available to AI across all clients"
- "Add Document" button (canEdit users)

**Expiration Alert** (if documents expiring):
- Amber background card with AlertCircle icon
- "X documents expiring soon — review for updates"

**Filter Bar**:
- Search input with Search icon
- Topic tag multi-select dropdown
- Topics with color coding:
  - VA Policy (blue)
  - CMS (emerald)
  - Federal IT (indigo)
  - Healthcare (pink)
  - Behavioral Health (purple)
  - Legislative (amber)
  - Other (slate)

**Document Table**:
- Columns: Document, Topics, Type, Uploaded, Status
- **Document column**: 
  - AI Active indicator (green dot) or Archived (gray dot)
  - Title + description
- **Topics column**: Colored topic chips
- **Uploaded column**: Date + uploaded by name
- **Status column**:
  - "AI Active" (emerald) / "Archived" (slate)
  - Expiration badges: "Xd left" (amber if <30 days, red if expired)

**Upload Modal Fields**:
- File selector
- Document title
- Topic tags (multi-select)
- Description/context (textarea)
- Expiration date (optional)
- AI usage toggle: Include in AI context / Store for reference only

---

### 7. Calendar View

**Main Calendar Grid**:
- Month/year header with prev/next navigation arrows
- Day headers: Sun, Mon, Tue, Wed, Thu, Fri, Sat
- Calendar cells (min-height 28):
  - Day number (current day has blue-600 background circle)
  - Meeting count badge (slate-200 background)
  - Up to 2 meeting preview cards (blue-50 background):
    - Time
    - Client name
  - "+X more" indicator if >2 meetings

**Right Sidebar - Selected Day Details**:
- Date header with CalendarIcon
- Meeting count
- Meeting cards showing:
  - Title + client
  - Status badge (Upcoming amber, In Progress blue, Completed emerald)
  - Time + duration (Clock icon)
  - Attendee count (Users icon)
  - "Join Meeting" button (upcoming meetings only)

**Sample Meetings**:
- Q2 Dashboard Review (CMS Data Analytics) - 1h, 4 attendees
- Security Compliance Sync (VA Modernization) - 45m, 3 attendees
- API Gateway Planning (HHS Integration Project) - 1h, 4 attendees
- Weekly Status Update (CMS Data Analytics) - 30m, 3 attendees

---

### 8. Task Board

**Full-width table** showing all tasks across all clients:
- Columns: Status, Task, Client, Owner, Due Date, Priority
- Status badges with StatusBadge component
- Priority badges: HIGH (red), MEDIUM (amber), LOW (blue)
- Sortable/filterable by client, status, priority

---

### 9. Pipeline Monitor

**Processing Status View**:
- Recent pipeline runs
- Processing steps with progress indicators
- 8-step pipeline:
  1. Uploading files
  2. Processing documents
  3. Loading client context & prompts
  4. Applying consultant context notes
  5. Generating analysis
  6. Creating client-facing summary
  7. Drafting follow-up email
  8. Creating task checklist

**Error Logs** (Admin only):
- Failed processing attempts
- Error details and timestamps

---

### 10. Transcript Upload

**Client-scoped upload form**:
- Client name + initials displayed in header
- Multiple file upload with "+" button
- Supported formats: .txt, .pdf, .docx, .mp3, .mp4, .wav, .m4a
- Per-file fields:
  - Document type selector (Meeting Transcript, Capability Doc, Email Thread, etc.)
  - Consultant context textarea (optional notes)
- "Process Transcript" button
- Back button to return to client

**Processing Pipeline View**:
- 8 steps with status indicators (pending, processing, complete)
- Real-time progress updates
- Error handling with retry options

---

### 11. Daily Sync

**Auto-generated daily briefing** showing:
- Today's meetings scheduled
- Overdue tasks by client
- Upcoming deadlines (48-hour window)
- Client relationship alerts
- Knowledge Base items needing review
- Generated daily at 6:00 AM ET

---

### 12. Settings (Admin Only)

**Three tabs**: Company Settings, Calendar & Automation, Integrations

#### Company Settings Tab:
- **Grace & Associates Description**: Editable textarea
  - Used in all AI prompts as company context
  - Describes firm capabilities, focus areas, client base

#### Calendar & Automation Tab:
- **Team Member Calendar Connections**: Table showing:
  - Name, Email, Calendar Status (green/red dot), Last Sync
  - "Connect Calendar" button (triggers Microsoft Graph OAuth)
- **Business Hours**: Start time, end time
- **Excluded Keywords**: Comma-separated list (e.g., "Personal", "Dentist", "Lunch")
- **Pre-Meeting Brief**: Lead time selector (1 hour / 2 hours / 4 hours / 1 day)

#### Integrations Tab:
Featured integrations with status cards:
- **Logto Identity Platform** (featured) - Status: Connected
- **OpenAI ChatGPT API** - API key field, test connection button
- **Otter.ai** - API key field, auto-monitoring toggle
- **Supabase** - Connection string, vector DB status
- **Google Drive** - OAuth connection, folder permissions

**User Management Table** (Admin only):
- Columns: Name, Email, Role (dropdown: Admin/Standard/Viewer), Calendar Connected, Last Active
- Add User button
- Role changes apply immediately

---

### 13. Master Record

**Chronological relationship summary** for a client showing:
- All meetings with full summaries
- Key decisions made
- Action items and their status
- Relationship milestones
- Strategic notes
- Full conversation history
- Searchable and filterable by date range

---

## File Structure

```
src/
├── app/
│   ├── contexts/
│   │   └── AuthContext.tsx (role system, user state)
│   ├── components/
│   │   ├── client-tabs/
│   │   │   ├── ClientOverview.tsx
│   │   │   ├── ClientStrategy.tsx
│   │   │   ├── ClientFinance.tsx
│   │   │   ├── ClientOperations.tsx
│   │   │   ├── ClientNotes.tsx
│   │   │   ├── ClientDocuments.tsx (two-panel browser)
│   │   │   └── ClientIntelligence.tsx
│   │   ├── Sidebar.tsx (nav with role-based filtering)
│   │   ├── Dashboard.tsx
│   │   ├── Login.tsx
│   │   ├── ClientsList.tsx
│   │   ├── ClientDetail.tsx (7-tab navigation)
│   │   ├── DocumentViewer.tsx (global file browser)
│   │   ├── CalendarView.tsx
│   │   ├── TaskBoard.tsx
│   │   ├── PipelineMonitor.tsx
│   │   ├── KnowledgeBase.tsx
│   │   ├── AdminSettings.tsx
│   │   ├── TranscriptUpload.tsx
│   │   ├── TranscriptViewer.tsx
│   │   ├── DailySync.tsx
│   │   ├── PreMeetingBrief.tsx
│   │   ├── MasterRecord.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── DocumentPill.tsx
│   │   └── ClientAvatar.tsx
│   └── App.tsx (main router with AuthProvider)
├── styles/
│   ├── theme.css (color tokens, base styles)
│   └── fonts.css (IBM Plex Sans & Mono imports)
└── imports/ (for future Figma assets)
```

---

## Component Patterns

### Status Badge Component
Props: `status` (scheduled, processing, complete, needs-review, overdue), `size` (sm, md, lg)

Returns colored badge with appropriate background/text colors:
- **Scheduled**: Amber background, dark amber text
- **Processing**: Blue background, dark blue text
- **Complete**: Emerald background, dark emerald text
- **Needs Review**: Amber background, dark amber text
- **Overdue**: Red background, dark red text

### Document Pill Component
Props: `type` (analysis, memo, summary, checklist, email)

Returns colored pill showing document type with icon.

### Client Avatar Component
Props: `initials`, `size`, `color` (optional)

Returns circular avatar with client initials.

---

## Authentication & Authorization Flow

1. **Unauthenticated State**: Show Login screen
2. **Login**: User clicks "Sign in with Microsoft"
3. **Logto Flow**: Redirect to Microsoft SSO via Logto
4. **Callback**: Logto returns user object with role
5. **AuthContext**: Stores user state, provides hasRole() and canEdit() functions
6. **App Render**: Shows main app with role-based filtering
7. **Logout**: Clears user state, returns to Login screen

### Role Checks in Components

```typescript
const { user, hasRole, canEdit } = useAuth();

// Check specific role
if (hasRole('admin')) {
  // Show admin-only content
}

// Check if user can edit
if (canEdit()) {
  // Show edit buttons (Admin + Standard can edit, Viewer cannot)
}

// Filter navigation items
const tabs = allTabs.filter(tab => {
  if (tab.adminOnly) return hasRole('admin');
  return true;
});
```

---

## AI Prompt Chain Architecture

**5-layer prompt structure** for document generation:

1. **GA Company Description** (from Admin Settings)
   - Firm capabilities and focus areas
   
2. **Client Description** (from Client Settings)
   - Client's mission, technical environment, priorities
   
3. **Meeting Type** (from upload form)
   - QBR, Technical Planning, Sprint Retrospective, etc.
   
4. **Consultant Context** (per-file notes from upload)
   - Specific observations or instructions
   
5. **Document Content** (uploaded files)
   - Transcript text or uploaded documents

Combined prompts sent to ChatGPT API to generate:
- Post-Meeting Analysis (internal)
- Internal Memo
- Client Summary (client-facing, requires review)
- Task Checklist
- Email Draft (client-facing, requires review)

**Client-Facing Documents**:
- Marked with "REQUIRES REVIEW" status badge
- Never auto-sent under any circumstance
- Must be explicitly approved by consultant
- "Approve & Send" button available after review

---

## Data Models (Mock Data Examples)

### User
```typescript
{
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'standard' | 'viewer';
  initials: string;
  calendarConnected: boolean;
  lastActive: string;
}
```

### Client
```typescript
{
  id: number;
  name: string;
  initials: string;
  contract: string;
  primaryContact: string;
  email: string;
  feeTier: 'high' | 'mid' | 'low';
  billingCadence: string;
  relationshipHealth: number; // 0-100
  lastMeeting: string;
}
```

### Meeting
```typescript
{
  id: number;
  client: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  attendees: number;
  status: 'scheduled' | 'processing' | 'complete' | 'needs-review' | 'overdue';
  documents: string[]; // document types
}
```

### Task
```typescript
{
  id: number;
  title: string;
  client: string;
  owner: string;
  due: string;
  status: 'scheduled' | 'processing' | 'complete' | 'needs-review' | 'overdue';
  priority: 'high' | 'medium' | 'low';
}
```

### Knowledge Base Document
```typescript
{
  id: number;
  title: string;
  topics: string[];
  fileType: string;
  uploadDate: string;
  uploadedBy: string;
  expirationDate: string | null;
  aiActive: boolean;
  description: string;
}
```

### File
```typescript
{
  id: number;
  name: string;
  folderId: string;
  client?: string;
  type: 'Meeting' | 'Upload' | 'Auto';
  date: string;
  uploadedBy: string;
  size: string;
  status: 'Ready' | 'Requires Review' | 'Delivered';
}
```

---

## Key Behaviors & Business Rules

1. **No Auto-Send**: Client-facing documents never sent automatically
2. **Role Visibility**: Restricted content completely hidden (not just locked) from unauthorized users
3. **Finance Tab**: Only visible to Admin role in client profiles
4. **Transcripts Folder**: Only visible to Admin role, completely absent for others
5. **Settings Page**: Only accessible to Admin role
6. **Viewer Actions**: Can only mark complete on their assigned tasks, all other action buttons hidden
7. **Eastern Time**: All timestamps displayed in ET
8. **Upload Location**: Upload moved from sidebar to Documents area per latest spec
9. **Knowledge Base Link**: Folder in Documents area that navigates to Knowledge Base page
10. **Calendar Integration**: Microsoft Graph API pulls team calendars for automatic meeting detection
11. **Expiration Alerts**: Knowledge Base documents with expiration dates within 14 days trigger dashboard alert
12. **Pipeline Processing**: 8-step automated pipeline runs after transcript upload
13. **Daily Sync Generation**: Auto-generated at 6:00 AM ET daily
14. **Master Record**: Chronological aggregate of all client interactions

---

## Future Integrations (Planned)

### Otter.ai Integration
- Auto-monitor for new transcripts
- Pull transcript text via API
- Match to client by meeting title/participants
- Trigger pipeline automatically

### ChatGPT API Integration
- Send 5-layer prompt to GPT-4
- Generate all 5 document types
- Stream responses for real-time updates
- Apply consultant review flags

### Supabase Integration
- Vector DB for meeting history search
- Semantic search across all transcripts
- RAG for Intelligence tab queries
- Store embeddings of all documents

### Google Drive Integration
- Automatic folder creation per client
- Upload generated documents
- Sync status back to GA App
- Folder permissions management

### Microsoft Graph API Integration
- Pull team member calendars
- Auto-detect client meetings
- Match to client by attendee email domains
- Generate pre-meeting briefs

---

## Deployment Notes

- **NOT a standard Vite setup** - special Figma Make environment
- Do NOT run `vite build` or `npm run build`
- Do NOT create `index.html` - entrypoint is `__figma__entrypoint__.ts` (auto-generated)
- Vite dev server already running - do NOT start manually
- Users cannot access localhost - preview surface used instead
- All user-facing docs, images, and assets in `/src/imports/` for Figma Make compatibility

---

## Design Tokens Reference

### Spacing Scale
- Compact density throughout (p-3, p-4, gap-2, gap-3 preferred)
- Card padding: p-6
- Section padding: p-8
- Icon sizes: 14-20px typical

### Border Radius
- Cards: rounded-lg (8px)
- Buttons: rounded-lg (8px)
- Badges/pills: rounded-md (6px)
- Avatars: rounded-full

### Shadow Scale
- Cards: shadow-sm
- Modals: shadow-xl
- Buttons: shadow-sm (hover: shadow-md)

### Font Sizes (inline styles, not Tailwind classes)
- Page titles: 2rem (32px), weight 600
- Section headers: 1.25-1.5rem (20-24px), weight 600
- Body text: 0.9375rem (15px), weight 400-500
- Secondary text: 0.8125-0.875rem (13-14px), weight 400
- Labels: 0.75rem (12px), weight 600, uppercase, letter-spacing 0.05em

---

## Testing Scenarios

### Admin User Flow
1. Login → Dashboard
2. Navigate to Clients → Select CMS Data Analytics
3. View all 7 tabs including Finance
4. Go to Documents tab → See Transcripts folder with lock icon
5. Navigate to Settings → View user management table

### Standard User Flow
1. Login → Dashboard
2. Navigate to Clients → Select VA Modernization
3. View 6 tabs (no Finance tab)
4. Go to Documents tab → Transcripts folder does not exist
5. Settings not visible in sidebar

### Viewer User Flow
1. Login → Dashboard (no Upload button visible)
2. Navigate to Clients → Select HHS Integration Project
3. View 6 tabs, all content read-only
4. Documents tab → Upload Here button not visible
5. Task Board → Mark Complete only on assigned tasks

### Knowledge Base Flow
1. Navigate to Knowledge Base from sidebar
2. See expiration alert if documents expiring soon
3. Filter by topics (VA Policy, CMS, Federal IT)
4. Click document to view details
5. Admin: Upload new document with topic tags and expiration date

### Calendar Flow
1. Navigate to Calendar
2. View current month grid with meeting previews
3. Click on date with meetings
4. Right sidebar shows full meeting details
5. Click "Join Meeting" on upcoming meeting

### Upload & Processing Flow
1. Select client from Clients list
2. Click Upload button in client header
3. Upload transcript files (.mp3, .txt, .pdf, etc.)
4. Select document types and add consultant context
5. Click "Process Transcript"
6. Watch 8-step pipeline progress
7. Navigate to Documents tab to see generated files
8. Client-facing docs show "Requires Review" status

---

## Mock Data Sets

**Clients**: CMS Data Analytics, VA Modernization, HHS Integration Project, FDA Reporting Portal, CDC Emergency Response (+ 25 more implied)

**Team Members**: Allie Grace (Admin), Sarah Chen, Michael Torres, Emma Williams, David Kim, Joe Grace, John Smith (Viewer example)

**Meeting Types**: QBR, Technical Planning, Sprint Retrospective, Security Compliance Sync, API Gateway Planning, Weekly Status Update, Emergency Response Brief, Architecture Review

**Document Types**: Post-Meeting Analysis, Internal Memo, Client Summary, Task Checklist, Email Draft, Capability Deck, Proposal, Slide Deck

**Topics (Knowledge Base)**: VA Policy, CMS, Federal IT, Healthcare, Behavioral Health, Legislative, Other

---

## Error Handling

- **Upload Failures**: Show error message, allow retry
- **API Failures**: Graceful degradation, show cached data when possible
- **Authentication Errors**: Redirect to login, clear session
- **Permission Denied**: Show message explaining insufficient permissions
- **Network Timeout**: Show retry button with timeout countdown
- **Invalid File Types**: Prevent upload, show supported formats

---

## Accessibility Considerations

- Semantic HTML structure
- ARIA labels on interactive elements
- Keyboard navigation support
- Focus indicators on all interactive elements
- Color contrast ratios meet WCAG AA standards
- Status conveyed with icons + text, not color alone
- Screen reader friendly status updates

---

## Performance Optimizations

- Lazy load client list and documents
- Virtual scrolling for large file lists
- Debounced search inputs
- Optimistic UI updates for actions
- Background processing for document generation
- Cached API responses where appropriate
- Image optimization for avatars and logos

---

## Security Considerations

- No sensitive data in localStorage (use secure httpOnly cookies)
- CSRF protection on all mutations
- Role checks on both frontend and backend
- API key rotation for integrations
- Audit logging for admin actions
- End-to-end encryption for transcripts (planned)
- SOC 2 compliance for federal clients

---

## End of Specification

This document represents the complete state of the Grace & Associates Meeting Intelligence System as of May 2026. All features, components, and behaviors described above have been implemented in the current codebase.

For questions or clarifications, contact: allie@graceassociates.com
