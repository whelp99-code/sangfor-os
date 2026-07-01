import { getPartnerDetail } from "@sangfor/business";
import { notFound } from "next/navigation";

import { EntityEditSheet } from "@/components/common/entity-edit-sheet";
import { DeleteEntityButton } from "@/components/common/delete-entity-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PageProps = { params: Promise<{ id: string }> };

export default async function PartnerDetailPage({ params }: PageProps) {
  const { id } = await params;
  const partner = await getPartnerDetail(id);
  if (!partner) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{partner.name}</h1>
        <div className="flex items-center gap-2 mt-2">
          <EntityEditSheet
            title="파트너 수정"
            endpoint={`/api/partners/${partner.id}`}
            fields={[
              { name: "name", label: "이름" },
              { name: "partnerType", label: "파트너 유형", type: "select", options: [
                { value: "reseller", label: "리셀러" },
                { value: "integration", label: "통합" },
              ]},
            ]}
            initial={{ name: partner.name, partnerType: partner.partnerType ?? "" }}
          />
          <DeleteEntityButton endpoint={`/api/partners/${partner.id}`} redirectTo="/partners" />
        </div>
      </div>
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
