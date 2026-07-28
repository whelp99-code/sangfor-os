import { redirect } from "next/navigation";

export default function PresalesPage() {
  redirect("/deals?view=presales");
}
