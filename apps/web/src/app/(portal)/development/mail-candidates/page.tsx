import { redirect } from "next/navigation";

export default function MailCandidatesPage() {
  redirect("/inbox?tab=candidates");
}
