import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider } from '@clerk/clerk-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { Login } from '@/pages/login';
import { NoAccess } from '@/pages/no-access';
import { Buildings } from '@/pages/buildings';
import { BuildingDetail } from '@/pages/building-detail';
import { ReportViewer } from '@/pages/report-viewer';
import NotFound from '@/pages/not-found';
import { ClientLayout } from '@/components/client-layout';
import { useClientAuth } from '@/hooks/use-client-auth';

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, hasAccess } = useClientAuth();
  const [, setLocation] = useLocation();

  // Redirect after render to avoid "setState during render" React warning
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLocation('/login');
    } else if (!hasAccess) {
      setLocation('/no-access');
    }
  }, [isLoaded, isSignedIn, hasAccess, setLocation]);

  if (!isLoaded || !isSignedIn || !hasAccess) return null;

  return <>{children}</>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/no-access" component={NoAccess} />

        {/* All protected routes share the client layout */}
        <Route>
          <ClientLayout>
            <ProtectedRoute>
              <Switch>
                <Route path="/" component={Buildings} />
                <Route path="/buildings/:address" component={BuildingDetail} />
                <Route path="/reports/:id" component={ReportViewer} />
                <Route component={NotFound} />
              </Switch>
            </ProtectedRoute>
          </ClientLayout>
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
    return (
      <div className="p-8 text-destructive">
        Error: VITE_CLERK_PUBLISHABLE_KEY is not set.
      </div>
    );
  }

  // Proxy Clerk's Frontend API through our own domain in production only.
  const isLiveKey = clerkPubKey.startsWith('pk_live_');
  const clerkProxyUrl = isLiveKey
    ? `${window.location.origin}/api/__clerk`
    : undefined;

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
