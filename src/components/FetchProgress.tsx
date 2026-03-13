interface FetchProgressProps {
  count: number;
  status: string;
}

export default function FetchProgress({ count, status }: FetchProgressProps) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-center gap-3">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <div>
          <p className="text-sm font-medium text-blue-800">{status}</p>
          <p className="text-xs text-blue-600">
            {count.toLocaleString()} events fetched
          </p>
        </div>
      </div>
    </div>
  );
}
