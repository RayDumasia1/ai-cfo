"use client";

import { useRouter } from "next/navigation";
import ImportUploader from "@/app/components/ImportUploader";

interface ImportRefresherProps {
  hasData?: boolean;
}

export default function ImportRefresher({ hasData }: ImportRefresherProps) {
  const router = useRouter();
  return (
    <ImportUploader hasData={hasData} onSuccess={() => router.refresh()} />
  );
}
