import type { CSSProperties, ReactNode } from 'react';

import { TYPE } from '@/lib/typography';

/**
 * Minimal, dependency-free Markdown renderer for AI chat answers (docs/08 §9 —
 * "markdown incl. **bold** rendered"). Supports the subset the assistant actually
 * emits: paragraphs, `#`/`##`/`###` headings, `-`/`*` and `1.` lists, **bold**,
 * *italic*, `inline code`, and `[links](url)`. It parses to React elements (never
 * `dangerouslySetInnerHTML`), so there is no HTML-injection surface, and unmatched
 * markers render literally — important while a response is still streaming. A
 * heavier library (react-markdown) was deliberately avoided to keep the lean,
 * fetch-not-SDK dependency philosophy of the codebase.
 */
export interface MarkdownProps {
  readonly content: string;
}

const CODE_STYLE: CSSProperties = {
  backgroundColor: 'var(--color-slate-100)',
  borderRadius: '4px',
  padding: '0.05rem 0.3rem',
  fontSize: '0.85em',
};

interface InlineRule {
  readonly type: 'code' | 'bold' | 'italic' | 'link';
  readonly regex: RegExp;
}

// Order matters only for tie-breaking at the same index: bold (`**`) is listed
// before italic (`*`) so `**x**` is not mis-read as two italic markers.
const INLINE_RULES: readonly InlineRule[] = [
  { type: 'code', regex: /`([^`]+)`/ },
  { type: 'bold', regex: /\*\*([^*]+?)\*\*/ },
  { type: 'bold', regex: /__([^_]+?)__/ },
  { type: 'italic', regex: /\*([^*]+?)\*/ },
  { type: 'italic', regex: /_([^_]+?)_/ },
  { type: 'link', regex: /\[([^\]]+)\]\(([^)\s]+)\)/ },
];

/** A safe link target: external http(s) or an in-app absolute path only. */
function isSafeHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith('/');
}

/** Render inline markdown within a single line/paragraph to React nodes. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let counter = 0;

  while (rest.length > 0) {
    let best: { rule: InlineRule; match: RegExpExecArray } | null = null;
    for (const rule of INLINE_RULES) {
      const match = rule.regex.exec(rest);
      if (match !== null && (best === null || match.index < best.match.index)) {
        best = { rule, match };
      }
    }

    if (best === null) {
      nodes.push(rest);
      break;
    }

    const { rule, match } = best;
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const key = `${keyPrefix}-${counter}`;
    counter += 1;

    if (rule.type === 'code') {
      nodes.push(
        <code key={key} className="font-data" style={CODE_STYLE}>
          {match[1]}
        </code>,
      );
    } else if (rule.type === 'bold') {
      nodes.push(
        <strong key={key} style={{ fontWeight: 600 }}>
          {match[1]}
        </strong>,
      );
    } else if (rule.type === 'italic') {
      nodes.push(<em key={key}>{match[1]}</em>);
    } else {
      const label = match[1];
      const href = match[2] ?? '';
      nodes.push(
        isSafeHref(href) ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--color-blue-700)', textDecoration: 'underline' }}
          >
            {label}
          </a>
        ) : (
          match[0]
        ),
      );
    }

    rest = rest.slice(match.index + match[0].length);
  }

  return nodes;
}

const HEADING_STYLE: Readonly<Record<number, CSSProperties>> = {
  1: TYPE.sectionHeader,
  2: TYPE.sectionHeader,
  3: TYPE.bodyStrong,
};

export function Markdown({ content }: MarkdownProps): React.JSX.Element {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ');
    blocks.push(
      <p key={`p-${key}`} style={TYPE.body}>
        {renderInline(text, `p-${key}`)}
      </p>,
    );
    key += 1;
    paragraph = [];
  };

  const flushList = (): void => {
    if (list === null) return;
    const { ordered, items } = list;
    const rendered = items.map((item, index) => (
      <li key={`li-${key}-${index}`} style={{ ...TYPE.body, marginLeft: '1.25rem' }}>
        {renderInline(item, `li-${key}-${index}`)}
      </li>
    ));
    blocks.push(
      ordered ? (
        <ol key={`l-${key}`} className="list-decimal" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {rendered}
        </ol>
      ) : (
        <ul key={`l-${key}`} className="list-disc" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {rendered}
        </ul>
      ),
    );
    key += 1;
    list = null;
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      const HeadingTag = (level === 3 ? 'h4' : level === 2 ? 'h3' : 'h3') as 'h3' | 'h4';
      blocks.push(
        <HeadingTag key={`h-${key}`} style={HEADING_STYLE[level] ?? TYPE.bodyStrong}>
          {renderInline(heading[2] ?? '', `h-${key}`)}
        </HeadingTag>,
      );
      key += 1;
      continue;
    }

    if (unordered !== null) {
      flushParagraph();
      if (list !== null && list.ordered) flushList();
      if (list === null) list = { ordered: false, items: [] };
      list.items.push(unordered[1] ?? '');
      continue;
    }

    if (ordered !== null) {
      flushParagraph();
      if (list !== null && !list.ordered) flushList();
      if (list === null) list = { ordered: true, items: [] };
      list.items.push(ordered[1] ?? '');
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();

  return <div className="flex flex-col gap-2">{blocks}</div>;
}
