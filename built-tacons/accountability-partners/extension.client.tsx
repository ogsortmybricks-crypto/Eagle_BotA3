import type { ClientExtension } from "@/tacons/Extensions";
import type { ViewPartners } from "./shared/view";
import { PartnersView } from "./client/PartnersView";
import { ApVerification } from "./client/ApVerification";

const extension: ClientExtension = {
  id: "accountability-partners",
  render: ({ data, target }) => (
    <PartnersView view={data as ViewPartners} target={target} />
  ),
  publicPages: [
    {
      path: "/verify/:token",
      render: params => <ApVerification token={params.token} apiPath="/verify" />,
    },
    {
      path: "/ap/verify/:token",
      render: (params) => <ApVerification token={params.token} />,
    },
  ],
};

export default extension;
