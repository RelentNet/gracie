import { redirect } from 'next/navigation';

/**
 * Default client-profile route → Overview tab (docs/08 §9, tab 1).
 */
export default async function ClientDetailIndex({
  params,
}: {
  readonly params: Promise<{ clientId: string }>;
}): Promise<never> {
  const { clientId } = await params;
  redirect(`/clients/${clientId}/overview`);
}
