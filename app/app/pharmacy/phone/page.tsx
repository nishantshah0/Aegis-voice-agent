import { PageHeader } from "@/components/ui";
import BrowserConversation from "@/app/present/BrowserConversation";
import { PhoneControl } from "@/app/present/OperatorControls";
import "@/app/present/page.css";

export const metadata = { title: "Phone · Pharmacy" };

export default function PharmacyPhone() {
  return <>
    <PageHeader title="Phone" description="Speak with the pharmacy using a fictional patient record." />
    <div className="workspace-controls mt-6 grid items-start gap-5 xl:grid-cols-2">
      <BrowserConversation />
      <PhoneControl />
    </div>
  </>;
}
