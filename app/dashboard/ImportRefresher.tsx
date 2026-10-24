"use client";

import { useRouter } from "next/navigation";
import ImportUploader from "@/app/components/ImportUploader";

interface ImportRefresherProps {
  hasData?: boolean;
  isNewUser?: boolean;
}

export default function ImportRefresher({ hasData, isNewUser }: ImportRefresherProps) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <ImportUploader
        hasData={hasData}
        isNewUser={isNewUser}
        onSuccess={() => router.refresh()}
      />
      <a href="/dashboard" className="inline-block text-sm underline" style={{color:"var(--teal)"}}>View dashboard</a>
    </div>
  );
}
