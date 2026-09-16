import AssistantPage from '../assistant/page';
import { CommandCenter } from '../dashboard/CommandCenter';

/**
 * Default landing (operator decision, 2026-08): you arrive on Gracie the
 * assistant — ready to talk immediately — with the #83 Daily Command Center
 * tiles kept alongside. On `xl`+ the assistant is the wide main column and the
 * tiles sit in a right rail; below `xl` they stack (assistant first, so you can
 * still start typing right away, tiles a short scroll down).
 *
 * Both surfaces are reused as-is: {@link AssistantPage} (the standalone /assistant
 * experience) and {@link CommandCenter} (the standalone /dashboard tiles). The
 * standalone routes still resolve directly, though the nav now points here.
 *
 * On `xl`+ the tiles rail is bounded to the viewport and scrolls on its own
 * (sticky at the top) so a long tile list never stretches the page — the chat
 * column keeps its own height. Below `xl` the rail stacks and flows normally.
 * (`xl`, not `lg`: at 1024–1279px — incl. 1920px screens at 150% zoom — a side
 * rail left the chat too narrow to use.)
 */
export default function HomePage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        <AssistantPage />
      </div>
      <aside className="flex shrink-0 flex-col xl:sticky xl:top-0 xl:max-h-[calc(100dvh-6rem)] xl:w-80 xl:overflow-y-auto 2xl:w-96">
        <CommandCenter variant="rail" />
      </aside>
    </div>
  );
}
