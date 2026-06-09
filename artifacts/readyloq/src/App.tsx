import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import InspectionsList from "@/pages/inspections/index";
import NewInspection from "@/pages/inspections/new";
import InspectionDetail from "@/pages/inspections/detail";
import AnalysisList from "@/pages/analysis/index";
import AnalysisDetail from "@/pages/analysis/detail";
import DatasetLibrary from "@/pages/dataset";
import ReportsList from "@/pages/reports/index";
import ReportDetail from "@/pages/reports/detail";
import TrainingCenter from "@/pages/training/index";
import QuizPage from "@/pages/training/quiz";
import Leaderboard from "@/pages/training/leaderboard";
import AnalyticsDashboard from "@/pages/analytics";
import SettingsPage from "@/pages/settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/inspections" component={InspectionsList} />
        <Route path="/inspections/new" component={NewInspection} />
        <Route path="/inspections/:id" component={InspectionDetail} />
        <Route path="/analysis" component={AnalysisList} />
        <Route path="/analysis/:id" component={AnalysisDetail} />
        <Route path="/dataset" component={DatasetLibrary} />
        <Route path="/reports" component={ReportsList} />
        <Route path="/reports/:id" component={ReportDetail} />
        <Route path="/training" component={TrainingCenter} />
        <Route path="/training/leaderboard" component={Leaderboard} />
        <Route path="/training/:id" component={QuizPage} />
        <Route path="/analytics" component={AnalyticsDashboard} />
        <Route path="/settings" component={SettingsPage} />
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
