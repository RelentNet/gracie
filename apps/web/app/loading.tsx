import { LoadingState } from '@/components/ui/StateViews';

export default function RootLoading(): React.JSX.Element {
  return (
    <div className="p-8">
      <LoadingState label="Loading GA App…" />
    </div>
  );
}
