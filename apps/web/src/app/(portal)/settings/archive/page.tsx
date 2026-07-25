import React from "react";
import { ArchiveCenter } from "@/components/archive/archive-center";

export default async function SettingsArchivePage() {
  return (
    <div className="settings-archive-page p-6">
      <h1 className="text-2xl font-bold mb-4">보관함 센터</h1>
      <ArchiveCenter />
    </div>
  );
}
