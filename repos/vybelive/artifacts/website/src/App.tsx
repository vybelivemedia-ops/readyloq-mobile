import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { WaitlistModal } from "@/components/WaitlistModal";

import Home from "@/pages/Home";
import About from "@/pages/About";
import Contact from "@/pages/Contact";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import AdminWaitlist from "@/pages/AdminWaitlist";
import AdminAccounts from "@/pages/AdminAccounts";
import TikTokReadiness from "@/pages/TikTokReadiness";
import Roadmap from "@/pages/Roadmap";
import DeleteAccount from "@/pages/DeleteAccount";

const queryClient = new QueryClient();

function MarketingLayout() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/roadmap" component={Roadmap} />
          <Route path="/about" component={About} />
          <Route path="/contact" component={Contact} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/terms" component={Terms} />
          <Route path="/delete-account" component={DeleteAccount} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <Footer />
    </div>
  );
}

function App() {
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  useEffect(() => {
    const handler = () => setWaitlistOpen(true);
    window.addEventListener("open-waitlist", handler);
    return () => window.removeEventListener("open-waitlist", handler);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/admin/waitlist" component={AdminWaitlist} />
            <Route path="/admin/accounts" component={AdminAccounts} />
            <Route path="/admin/tiktok" component={TikTokReadiness} />
            <Route component={MarketingLayout} />
          </Switch>
        </WouterRouter>
        <WaitlistModal open={waitlistOpen} onOpenChange={setWaitlistOpen} />
        <Toaster theme="dark" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
