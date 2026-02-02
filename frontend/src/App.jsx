import { NavMenu } from "@shopify/app-bridge-react";
import { Routes, Route, Link } from "react-router-dom";
import { useEffect, useRef } from "react";
import Home from "./pages/Home";
import WorkshopTemplates from "./pages/WorkshopTemplate";
import WorkshopSettings from "./pages/WorkshopSettings";
import WorkshopRegistrations from "./pages/WorkshopRegistrations";
import SubsRemover from "./pages/SubsRemover";
import RemovalResults from "./pages/RemovalResults";
import OrderOutcomes from "./pages/OrderOutcomes";
import SubsCancellations from "./pages/SubsCancellations";
import makeShopifyFetch from "./lib/apiFetch";
import toast, { Toaster } from "react-hot-toast";

function App() {
  const didBootstrap = useRef(false);
  const search = window.location.search || "";

  useEffect(() => {
    if (didBootstrap.current) return;
    didBootstrap.current = true;

    const run = async () => {
      const t = toast.loading("Bootstrapping...");
      try {
        const shopifyFetch = makeShopifyFetch();
        const r = await shopifyFetch("/api/bootstrap", { method: "POST" });
        const json = await r.json().catch(() => null);

        toast.dismiss(t);

        if (!r.ok || !json?.ok) {
          toast.error("Bootstrap failed");
          console.log("Bootstrap failed:", r.status, json);
          return;
        }

        toast.success(json?.already ? "Already connected" : "Token saved");
        console.log("Bootstrap ok:", json);
      } catch (e) {
        toast.dismiss(t);
        toast.error("Bootstrap error");
        console.log("Bootstrap error:", e);
      }
    };

    run();
  }, []);

  return (
    <>
      <Toaster position="top-right" />

      <NavMenu>
        <Link to={{ pathname: "/", search }} rel="home">
          Home
        </Link>
        <Link to={{ pathname: "/workshop", search }}>Workshop Template</Link>
        <Link to={{ pathname: "/workshop-settings", search }}>Workshop Settings</Link>
        <Link to={{ pathname: "/workshop-registrations", search }}>Registrations</Link>
        <Link to={{ pathname: "/subs-remover", search }}>Subs Remover</Link>
        <Link to={{ pathname: "/removal-results", search }}>Removal Results</Link>
        <Link to={{ pathname: "/orders/outcomes", search }}>Order Outcomes</Link>
        <Link to={{ pathname: "/subs/cancellations", search }}>Cancellation Outcomes</Link>
      </NavMenu>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/workshop" element={<WorkshopTemplates />} />
        <Route path="/workshop-settings" element={<WorkshopSettings />} />
        <Route path="/workshop-registrations" element={<WorkshopRegistrations />} />
        <Route path="/subs-remover" element={<SubsRemover />} />
        <Route path="/removal-results" element={<RemovalResults />} />
        <Route path="/orders/outcomes" element={<OrderOutcomes />} />
        <Route path="/subs/cancellations" element={<SubsCancellations />} />
      </Routes>
    </>
  );
}

export default App;
