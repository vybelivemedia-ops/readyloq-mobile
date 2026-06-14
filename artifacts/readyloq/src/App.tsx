import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation, Link } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { useCurrentUser } from "@/hooks/use-current-user";
import Dashboard from "@/pages/dashboard";
import InspectionsList from "@/pages/inspections/index";
import NewInspection from "@/pages/inspections/new";
import InspectionDetail from "@/pages/inspections/detail";
import PropertiesList from "@/pages/properties/index";
import PropertyDetail from "@/pages/properties/detail";
import AnalysisList from "@/pages/analysis/index";
import AnalysisDetail from "@/pages/analysis/detail";
import DatasetLibrary from "@/pages/dataset";
import ReportsList from "@/pages/reports/index";
import ReportDetail from "@/pages/reports/detail";
import TrainingCenter from "@/pages/training/index";
import QuizPage from "@/pages/training/quiz";
import Leaderboard from "@/pages/training/leaderboard";
import AnalyticsDashboard from "@/pages/analytics";
import CommandCenter from "@/pages/command";
import SettingsPage from "@/pages/settings";
import CapabilityCenter from "@/pages/capability";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  theme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  variables: {
    colorPrimary: "#0ea5e9",
    colorBackground: "#1e293b",
    colorForeground: "#f8fafc",
    colorMutedForeground: "#94a3b8",
    colorDanger: "#ef4444",
    colorNeutral: "#334155",
    colorInput: "#0f172a",
    colorInputForeground: "#f8fafc",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-slate-800 rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl border border-slate-700/50",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white font-bold",
    headerSubtitle: "text-slate-400",
    socialButtonsBlockButtonText: "text-slate-200",
    formFieldLabel: "text-slate-300",
    footerActionLink: "text-sky-400",
    footerActionText: "text-slate-400",
    dividerText: "text-slate-500",
    identityPreviewEditButton: "text-sky-400",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-slate-200",
    logoBox: "flex justify-center pb-1",
    logoImage: "h-14 w-14",
    socialButtonsBlockButton: "border-slate-600 bg-slate-700 hover:bg-slate-600",
    formButtonPrimary: "bg-sky-500 hover:bg-sky-400 text-white font-semibold",
    formFieldInput: "bg-slate-900 border-slate-600 text-white placeholder:text-slate-500",
    footerAction: "border-slate-700/50",
    dividerLine: "bg-slate-700",
    alert: "border-slate-700/50",
    otpCodeFieldInput: "bg-slate-900 border-slate-600 text-white",
    formFieldRow: "",
    main: "",
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function WelcomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-background gap-8 px-6">
      <div className="text-center space-y-4">
        <img
          src={`${basePath}/logo.png`}
          alt="ReadyLoq"
          className="w-20 h-20 rounded-2xl mx-auto"
        />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Ready<span className="text-primary">Loq</span>
          </h1>
          <p className="text-muted-foreground mt-1.5">AI-Powered Inspection Intelligence</p>
        </div>
        <p className="text-sm text-muted-foreground max-w-xs">
          The field copilot for pest control professionals — smarter captures, better reports.
        </p>
      </div>
      <Link href="/sign-in">
        <Button size="lg" className="px-10 font-semibold">
          Sign In
        </Button>
      </Link>
    </div>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

function HomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect to="/inspections" />;
  return <WelcomePage />;
}

function ProtectedRoutes() {
  const { isLoaded, isSignedIn } = useAuth();
  const { data: currentUser } = useCurrentUser();
  const isManager = currentUser?.role === "manager";

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;

  return (
    <Layout>
      <Switch>
        <Route path="/inspections" component={InspectionsList} />
        <Route path="/inspections/new" component={NewInspection} />
        <Route path="/inspections/:id" component={InspectionDetail} />
        <Route path="/properties" component={PropertiesList} />
        <Route path="/properties/:addressKey" component={PropertyDetail} />
        <Route path="/analysis" component={AnalysisList} />
        <Route path="/analysis/:id" component={AnalysisDetail} />
        <Route path="/dataset" component={DatasetLibrary} />
        <Route path="/reports" component={ReportsList} />
        <Route path="/reports/:id" component={ReportDetail} />
        <Route path="/training" component={TrainingCenter} />
        <Route path="/training/leaderboard" component={Leaderboard} />
        <Route path="/training/:id" component={QuizPage} />
        <Route path="/analytics" component={AnalyticsDashboard} />
        {isManager && <Route path="/command" component={CommandCenter} />}
        <Route path="/settings" component={SettingsPage} />
        <Route path="/capability" component={CapabilityCenter} />
        <Route path="/" component={Dashboard} />
        <Route>
          <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center min-h-[50vh]">
            <h2 className="text-2xl font-bold mb-2">Page Not Found</h2>
            <p>The requested route does not exist.</p>
          </div>
        </Route>
      </Switch>
    </Layout>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route component={ProtectedRoutes} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to ReadyLoq",
          },
        },
        signUp: {
          start: {
            title: "Join ReadyLoq",
            subtitle: "Create your inspection account",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <AppRoutes />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}
