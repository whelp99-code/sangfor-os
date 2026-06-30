export const dynamic = "force-dynamic";

import { listPartners } from "@sangfor/business";

import { CreatePartnerForm } from "@/components/customers/create-partner-form";
import { PartnerFilterTable } from "@/components/customers/partner-filter-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default async function PartnersPage() {
  const partners = await listPartners();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog>
          <DialogTrigger render={<Button size="sm">+ 새 파트너</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 파트너 등록</DialogTitle>
            </DialogHeader>
            <CreatePartnerForm />
          </DialogContent>
        </Dialog>
      </div>

      <PartnerFilterTable
        partners={partners.map((p) => ({
          id: p.id,
          name: p.name,
          partnerType: p.partnerType,
          kind: p.kind,
          status: p.status,
          customerLinks: p.customerLinks,
          contacts: p.contacts,
          _count: p._count,
        }))}
        total={partners.length}
      />
    </div>
  );
}
