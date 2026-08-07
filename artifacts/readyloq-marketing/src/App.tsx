import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { ClerkProvider } from "@clerk/clerk-react";

// Pages
import Home from "@/pages/home";
import Features from "@/pages/features";
import Solutions from "@/pages/solutions";
import Demo from "@/pages/demo";
import Contact from "@/pages/contact";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";

const queryClient = new QueryClient();
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function Router() {
  return (
    <Switch>
      {/* Auth + admin pages — full-screen, no marketing chrome */}
      <Route path="/login" component={Login} />
      <Route path="/dashboard" component={Dashboard} />

      {/* Public marketing pages — wrapped in Layout */}
      <Route>
        <Layout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/features" component={Features} />
            <Route path="/solutions" component={Solutions} />
            <Route path="/demo" component={Demo} />
            <Route path="/contact" component={Contact} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/terms" component={Terms} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  const inner = (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );

  // Wrap with Clerk only when the publishable key is present so the marketing
  // site still renders in environments that haven't configured it.
  if (clerkPubKey) {
    return <ClerkProvider publishableKey={clerkPubKey}>{inner}</ClerkProvider>;
  }
  return inner;
}

export default App;
