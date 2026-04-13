"use client";

import { useRouter } from "next/navigation";
import ImportUploader from "@/app/components/ImportUploader";

export default function ImportRefresher() {
  const router = useRouter();
  return <ImportUploader onSuccess={() => router.refresh()} />;
}
