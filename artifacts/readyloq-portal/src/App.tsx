import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider } from '@clerk/clerk-react';
import { setBaseUrl } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { apiClientBaseUrl } from '@/config';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { IndexRedirect } from '@/pages/index';
import { Login } from '@/pages/login';
import { NoCompany } from '@/pages/no-company';
import { Dashboard } from '@/pages/dashboard';
import { InspectionsList } from '@/pages/inspections/list';
import { InspectionDetail } from '@/pages/inspections/detail';
import { Reports } from '@/pages/reports';
import { Team } from '@/pages/team';
import { TechActivity } from '@/pages/tech-activity';
import { Opportunities } from '@/pages/opportunities';
import { Properties } from '@/pages/properties';
import { Analytics } from '@/pages/analytics';
import { Schedule } from '@/pages/schedule';
import { ClientAccess } from '@/pages/client-access';
import { ClientPortal } from '@/pages/client';
import { BleHealth } from '@/pages/ble-health';
import { IntelligenceReview } from '@/pages/intelligence-review';
import { Integrations } from '@/pages/integrations';
import { Layout } from '@/components/layout';

const queryClient = new QueryClient();

// Generated API hooks use root-relative paths. In development, keep those
// requests under this artifact's base path so Vite's API proxy can route them
// to the API server instead of the separate `/api` mobile artifact.
setBaseUrl(apiClientBaseUrl);

// Protected route wrapper — redirects via useEffect to avoid setState-during-render warnings.
function ProtectedRoute({ component: Component, roles }: { component: any, roles?: string[] }) {
  const { isLoaded, isSignedIn, me } = useAuth();
  const [, setLocation] = useLocation();

  const redirectTo =
    !isLoaded ? null
    : !isSignedIn ? '/login'
    : !me?.companyId ? '/no-company'
    : roles && !roles.includes(me.effectiveRole) ? '/'
    : null;

  useEffect(() => {
    if (redirectTo) setLocation(redirectTo);
  }, [redirectTo, setLocation]);

  if (!isLoaded || redirectTo) return null;

  return <Component />;
}

// Ensure useAuth can be imported above or we define it:
import { useAuth } from '@/hooks/use-auth';

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/no-company" component={NoCompany} />
        <Route path="/">
          <IndexRedirect />
        </Route>
        <Route path="/inspections/:id">
          <Layout>
            <ProtectedRoute component={InspectionDetail} roles={['owner', 'manager', 'sales', 'technician']} />
          </Layout>
        </Route>
        
        {/* Protected routes wrapped in Layout */}
        <Route path="/:rest*">
          <Layout>
            <Switch>
              <Route path="/dashboard">
                <ProtectedRoute component={Dashboard} roles={['owner', 'manager']} />
              </Route>
              <Route path="/inspections">
                <ProtectedRoute component={InspectionsList} roles={['owner', 'manager', 'sales', 'technician']} />
              </Route>
              <Route path="/reports">
                <ProtectedRoute component={Reports} roles={['owner', 'manager', 'sales']} />
              </Route>
              <Route path="/team">
                <ProtectedRoute component={Team} roles={['owner', 'manager']} />
              </Route>
              <Route path="/team/:userId/activity">
                <ProtectedRoute component={TechActivity} roles={['owner', 'manager']} />
              </Route>
              <Route path="/opportunities">
                <ProtectedRoute component={Opportunities} roles={['owner', 'sales']} />
              </Route>
              <Route path="/properties">
                <ProtectedRoute component={Properties} roles={['owner', 'manager', 'technician']} />
              </Route>
              <Route path="/analytics">
                <ProtectedRoute component={Analytics} roles={['owner', 'manager']} />
              </Route>
              <Route path="/schedule">
                <ProtectedRoute component={Schedule} roles={['owner', 'manager', 'sales']} />
              </Route>
              <Route path="/client-access">
                <ProtectedRoute component={ClientAccess} roles={['owner', 'manager']} />
              </Route>
              <Route path="/ai-review">
                <ProtectedRoute component={IntelligenceReview} roles={['owner', 'manager']} />
              </Route>
              <Route path="/integrations">
                <ProtectedRoute component={Integrations} roles={['owner']} />
              </Route>
              <Route path="/ble-health">
                <ProtectedRoute component={BleHealth} roles={['owner', 'manager']} />
              </Route>
              <Route path="/client">
                <ProtectedRoute component={ClientPortal} roles={['property_manager']} />
              </Route>
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </Route>
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!clerkPubKey) {
    return <div className="p-8 text-destructive">Error: VITE_CLERK_PUBLISHABLE_KEY is not set.</div>;
  }

  // Proxy Clerk's Frontend API through our own domain in production only.
  // The server-side proxy middleware at /api/__clerk activates only for live
  // keys (sk_live_*). For test/dev keys it is a no-op, so the ClerkProvider
  // must NOT set proxyUrl or Clerk will route Frontend API traffic to an
  // unhandled path and fail to initialise.
  const isLiveKey = clerkPubKey.startsWith('pk_live_');
  const clerkProxyUrl = isLiveKey ? `${window.location.origin}/api/__clerk` : undefined;

  return (
    <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;