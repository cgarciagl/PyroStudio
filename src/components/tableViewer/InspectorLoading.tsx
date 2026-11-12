import { Loader2 } from "lucide-react";

/** Loading state shared by the inspector panels (one look, neutral color). */
export function InspectorLoading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center py-20 text-fg-muted text-xs">
      <Loader2 className="w-5 h-5 animate-spin text-fg-muted mr-2" />
      <span>{label}</span>
    </div>
  );
}
