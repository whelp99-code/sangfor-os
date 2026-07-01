import { getPartnerDetail } from "@sangfor/business";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PageProps = { params: Promise<{ id: string }> };

export default async function PartnerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const partner = await getPartnerDetail(id);
  if (!partner) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{partner.name}</h1>
      <Card>
        <CardHeader><CardTitle>연결된 고객사</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {partner.customerLinks.map((l) => (
            <div key={l.id}>{l.customer.name}</div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
