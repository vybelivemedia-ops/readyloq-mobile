import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";
import Quinn from "@/pages/Quinn";
import CommandCenter from "@/pages/CommandCenter";
import Overview from "@/pages/Overview";
import ExecutiveDetail from "@/pages/ExecutiveDetail";
import Tasks from "@/pages/Tasks";
import Objectives from "@/pages/Objectives";
import ObjectiveDetail from "@/pages/ObjectiveDetail";
import HQExperience from "@/hq/HQExperience";
import AIIntelligence from "@/pages/AIIntelligence";
import Collaboration from "@/pages/Collaboration";
import FounderProfile from "@/pages/FounderProfile";
import COOBriefing from "@/pages/COOBriefing";
import DevTools from "@/pages/DevTools";
import Diagnostics from "@/pages/Diagnostics";
import Engineering from "@/pages/Engineering";
import BlockerCenter from "@/pages/BlockerCenter";
import Portfolio from "@/pages/Portfolio";
import Learning from "@/pages/Learning";
import Autonomy from "@/pages/Autonomy";
import Headquarters from "@/pages/Headquarters";
import Timeline from "@/pages/Timeline";
import Conversations from "@/pages/Conversations";
import Recommendations from "@/pages/Recommendations";
import Specialists from "@/pages/Specialists";
import Marketing from "@/pages/Marketing";
import Operations from "@/pages/Operations";
import Memory from "@/pages/Memory";
import Connectors from "@/pages/Connectors";
import Social from "@/pages/Social";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60,
    },
  },
});

function ClassicRoutes() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={CommandCenter} />
        <Route path="/quinn" component={Quinn} />
        <Route path="/overview" component={Overview} />
        <Route path="/executives/:executiveId" component={ExecutiveDetail} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/objectives" component={Objectives} />
        <Route path="/objectives/:objectiveId" component={ObjectiveDetail} />
        <Route path="/briefing" component={COOBriefing} />
        <Route path="/headquarters" component={Headquarters} />
        <Route path="/timeline" component={Timeline} />
        <Route path="/conversations" component={Conversations} />
        <Route path="/recommendations" component={Recommendations} />
        <Route path="/ai-intelligence" component={AIIntelligence} />
        <Route path="/collaboration" component={Collaboration} />
        <Route path="/founder-profile" component={FounderProfile} />
        <Route path="/portfolio" component={Portfolio} />
        <Route path="/learning" component={Learning} />
        <Route path="/autonomy" component={Autonomy} />
        <Route path="/dev-tools" component={DevTools} />
        <Route path="/diagnostics" component={Diagnostics} />
        <Route path="/specialists" component={Specialists} />
        <Route path="/marketing" component={Marketing} />
        <Route path="/social" component={Social} />
        <Route path="/operations" component={Operations} />
        <Route path="/memory" component={Memory} />
        <Route path="/connectors" component={Connectors} />
        <Route path="/engineering" component={Engineering} />
        <Route path="/blockers" component={BlockerCenter} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function Router() {
  return (
    <Switch>
      {/* Cinematic 3D headquarters at /hq */}
      <Route path="/hq" component={HQExperience} />
      {/* All classic dashboard routes */}
      <Route path="/" component={ClassicRoutes} />
      <Route path="/quinn" component={ClassicRoutes} />
      <Route path="/overview" component={ClassicRoutes} />
      <Route path="/executives/:executiveId" component={ClassicRoutes} />
      <Route path="/tasks" component={ClassicRoutes} />
      <Route path="/objectives" component={ClassicRoutes} />
      <Route path="/objectives/:objectiveId" component={ClassicRoutes} />
      <Route path="/briefing" component={ClassicRoutes} />
      <Route path="/headquarters" component={ClassicRoutes} />
      <Route path="/timeline" component={ClassicRoutes} />
      <Route path="/conversations" component={ClassicRoutes} />
      <Route path="/recommendations" component={ClassicRoutes} />
      <Route path="/ai-intelligence" component={ClassicRoutes} />
      <Route path="/collaboration" component={ClassicRoutes} />
      <Route path="/founder-profile" component={ClassicRoutes} />
      <Route path="/portfolio" component={ClassicRoutes} />
      <Route path="/learning" component={ClassicRoutes} />
      <Route path="/autonomy" component={ClassicRoutes} />
      <Route path="/dev-tools" component={ClassicRoutes} />
      <Route path="/diagnostics" component={ClassicRoutes} />
      <Route path="/specialists" component={ClassicRoutes} />
      <Route path="/marketing" component={ClassicRoutes} />
      <Route path="/social" component={ClassicRoutes} />
      <Route path="/operations" component={ClassicRoutes} />
      <Route path="/memory" component={ClassicRoutes} />
      <Route path="/connectors" component={ClassicRoutes} />
      <Route path="/engineering" component={ClassicRoutes} />
      <Route path="/blockers" component={ClassicRoutes} />
      <Route component={ClassicRoutes} />
    </Switch>
  );
}

function App() {
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

export default App;
