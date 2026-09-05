import { ArrowLeft } from "lucide-react";
import { Button } from "./ds/Button";
import { customerReturnUrl, navigateCustomerUrl } from "../utils/customerNavigation";

export function CustomerReturnLink() {
  const target = customerReturnUrl(new URL(location.href));
  if (!target) return null;
  return (
    <div className="customer-return-link">
      <Button icon={<ArrowLeft />} onClick={() => navigateCustomerUrl(target)}>
        Back to customer
      </Button>
    </div>
  );
}
