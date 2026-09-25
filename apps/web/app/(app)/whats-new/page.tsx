import { Card } from '@/components/ui/Card';
import { PageContainer } from '@/components/ui/PageContainer';
import { CHANGELOG } from '@/lib/changelog';
import { TYPE } from '@/lib/typography';

/**
 * What's New — the in-app changelog (any signed-in role). Rendered from
 * `lib/changelog.ts`, the same source as the sidebar version number, so the two
 * can never disagree.
 */

function formatDate(iso: string): string {
  // Dates are calendar days, not instants — format in UTC so no time zone shifts them.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function WhatsNewPage(): React.JSX.Element {
  return (
    <PageContainer width="md" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>What’s New</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Every update to Gracie, newest first.
        </p>
      </header>

      {CHANGELOG.map((release, index) => (
        <Card key={release.version} className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span style={{ ...TYPE.sectionHeader, color: 'var(--text-primary)' }}>v{release.version}</span>
              <span
                className="rounded-md"
                style={{
                  backgroundColor: 'var(--brand-soft)',
                  color: 'var(--text-primary)',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  padding: '0.0625rem 0.375rem',
                }}
              >
                {release.stage}
              </span>
              {index === 0 ? (
                <span
                  className="rounded-md"
                  style={{
                    backgroundColor: 'var(--color-emerald-500)',
                    color: '#ffffff',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    padding: '0.0625rem 0.375rem',
                  }}
                >
                  Latest
                </span>
              ) : null}
            </div>
            <span style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>{release.title}</span>
            <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{formatDate(release.date)}</span>
          </div>

          {release.sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-2">
              <h2 style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>{section.heading}</h2>
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                {section.items.map((item) => (
                  <li key={item} style={{ ...TYPE.body, color: 'var(--text-secondary)' }}>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Card>
      ))}
    </PageContainer>
  );
}
