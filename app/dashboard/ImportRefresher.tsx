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
    <ImportUploader
      hasData={hasData}
      isNewUser={isNewUser}
      onSuccess={() => router.refresh()}
    />
  );
}
