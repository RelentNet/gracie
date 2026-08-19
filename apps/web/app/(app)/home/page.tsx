import AssistantPage from '../assistant/page';
import { CommandCenter } from '../dashboard/CommandCenter';

/**
 * Default landing (operator decision, 2026-08): you arrive on Gracie the
 * assistant — ready to talk immediately — with the #83 Daily Command Center
 * tiles kept alongside. On `lg`+ the assistant is the wide main column and the
 * tiles sit in a right rail; below `lg` they stack (assistant first, so you can
 * still start typing right away, tiles a short scroll down).
 *
 * Both surfaces are reused as-is: {@link AssistantPage} (the standalone /assistant
 * experience) and {@link CommandCenter} (the standalone /dashboard tiles). The
 * standalone routes still resolve directly, though the nav now points here.
 *
 * On `lg`+ the tiles rail is bounded to the viewport and scrolls on its own
 * (sticky at the top) so a long tile list never stretches the page — the chat
 * column keeps its own height. Below `lg` the rail stacks and flows normally.
 */
export default function HomePage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <AssistantPage />
      </div>
      <aside className="flex shrink-0 flex-col lg:sticky lg:top-0 lg:max-h-[calc(100dvh-6rem)] lg:w-80 lg:overflow-y-auto xl:w-96">
        <CommandCenter variant="rail" />
      </aside>
    </div>
  );
}
