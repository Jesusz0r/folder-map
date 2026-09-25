"use client";

import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-1 flex-col justify-center gap-4 px-4 py-16">
      <Alert variant="destructive">
        <AlertTitle>Folder Map hit a problem</AlertTitle>
        <AlertDescription>
          {error.message || "Something went wrong while drawing the treemap."}
        </AlertDescription>
      </Alert>
      <Button type="button" onClick={reset} className="self-start">
        Try again
      </Button>
    </div>
  );
}
