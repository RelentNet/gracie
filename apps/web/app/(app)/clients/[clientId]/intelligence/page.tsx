import { PagePlaceholder } from '@/components/ui/PagePlaceholder';

/**
 * Client tab 7 — Intelligence (docs/08 §9). Client-scoped AI chat. Retrieval is
 * role-filtered so restricted content never reaches unauthorized users
 * (docs/06 §7). All AI access goes through the provider interface (D11).
 */
export default function ClientIntelligencePage(): React.JSX.Element {
  return (
    <PagePlaceholder
      title="Intelligence"
      description="AI assistant scoped to this client."
      emptyTitle="Start a conversation"
      emptyDescription="A scoped chat with an online-research toggle and message history will appear here once the AI provider is connected. Retrieval is role-filtered."
    />
  );
}
