import { Link, useLocation } from "wouter";
import { useGetServerVersion } from "@workspace/api-client-react";
import { buildInfo } from "@/buildInfo";
import {
  Activity,
  FileText,
  Target,
  CheckSquare,
  UsersRound,
  Cpu,
  Megaphone,
  GitBranch,
  Gauge,
  Building2,
  Brain,
  GraduationCap,
  Wrench,
  History,
  MessagesSquare,
  Lightbulb,
  Users,
  UserCircle,
  Bot,
  ShieldAlert,
  Menu,
  ChevronDown,
  ChevronRight,
  Mic,
  Send,
  Bell,
  Box,
  LayoutDashboard,
  Search,
  BrainCircuit,
  Plug,
  Radio
} from "lucide-react";
import CommandPalette, { pushCommandHistory } from "@/components/CommandPalette";
import {
  useListExecutives,
  useListApprovals,
  useSendExecutiveMessage,
  getListApprovalsQueryKey
} from "@workspace/api-client-react";
import { execStatusStyle } from "@/lib/execStatus";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";

function NavItem({ href, icon: Icon, label, isActive }: { href: string; icon: any; label: string; isActive: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium ${
        isActive
          ? "bg-primary/20 text-primary border border-primary/20 neon-text-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
      }`}
    >
      <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-primary" : ""}`} />
      <span>{label}</span>
    </Link>
  );
}

function BuildStamp() {
  const { data: serverBuild } = useGetServerVersion();
  return (
    <div className="border-t border-border/50 pt-3 mt-2 px-3 pb-1 text-[10px] font-mono text-muted-foreground/70 space-y-0.5">
      <p className="uppercase tracking-wider text-muted-foreground">Build</p>
      <p className="truncate" title={buildInfo.commitMessage}>
        ui {buildInfo.commitSha.slice(0, 7)} · {buildInfo.branch}
        {buildInfo.workingTreeStatus === "dirty" ? " *" : ""}
      </p>
      {serverBuild && (
        <p className="truncate" title={serverBuild.commitMessage}>
          api {serverBuild.commitSha.slice(0, 7)} · {serverBuild.branch}
          {serverBuild.workingTreeStatus === "dirty" ? " *" : ""}
        </p>
      )}
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: execsData } = useListExecutives();
  const executives = execsData ?? [];
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [secondaryNavOpen, setSecondaryNavOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isDictating, setIsDictating] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  
  const { data: pendingApprovals = [] } = useListApprovals(
    { status: "pending" },
    { query: { queryKey: getListApprovalsQueryKey({ status: "pending" }), refetchInterval: 30000 } },
  );
  const unreadCount = pendingApprovals.length;

  const sendMessage = useSendExecutiveMessage();

  const quinn = executives.find((e) => e.role === "chief_of_staff");
  const team = executives.filter((e) => e.role !== "chief_of_staff");

  const recognitionRef = useRef<any>(null);
  const speechSupported = typeof window !== "undefined" && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setMessage((prev) => (prev ? prev + ' ' + finalTranscript : finalTranscript));
      }
    };

    recognition.onerror = () => setIsDictating(false);
    recognition.onend = () => setIsDictating(false);

    recognitionRef.current = recognition;
    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.abort(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    };
  }, []);

  const toggleDictation = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (isDictating) {
      recognition.stop();
      setIsDictating(false);
    } else {
      try {
        recognition.start();
        setIsDictating(true);
      } catch {
        setIsDictating(false);
      }
    }
  };

  const dispatchToQuinn = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || !quinn) return;
    pushCommandHistory(trimmed);
    sendMessage.mutate(
      { executiveId: quinn.id, data: { content: trimmed } },
      {
        onSuccess: () => {
          setMessage("");
          setLocation("/quinn");
        }
      }
    );
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    dispatchToQuinn(message);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const primaryNavItems = [
    { href: "/", icon: Activity, label: "Command Center" },
    { href: "/briefing", icon: FileText, label: "Daily Briefing" },
    { href: "/objectives", icon: Target, label: "Objectives" },
    { href: "/tasks", icon: CheckSquare, label: "Global Tasks" },
    { href: "/specialists", icon: UsersRound, label: "Agent Registry" },
    { href: "/operations", icon: Cpu, label: "Operations" },
    { href: "/memory", icon: BrainCircuit, label: "Memory Engine" },
    { href: "/connectors", icon: Plug, label: "Connectors" },
    { href: "/marketing", icon: Megaphone, label: "Marketing" },
    { href: "/social", icon: Radio, label: "Social" },
    { href: "/engineering", icon: GitBranch, label: "Engineering" },
    { href: "/diagnostics", icon: Gauge, label: "QA / Diagnostics" },
    { href: "/portfolio", icon: Building2, label: "Portfolio" },
    { href: "/ai-intelligence", icon: Brain, label: "AI Intelligence" },
    { href: "/learning", icon: GraduationCap, label: "Learning" },
    { href: "/dev-tools", icon: Wrench, label: "Settings" },
  ];

  const secondaryNavItems = [
    { href: "/timeline", icon: History, label: "Timeline" },
    { href: "/conversations", icon: MessagesSquare, label: "Conversations" },
    { href: "/recommendations", icon: Lightbulb, label: "Recommendations" },
    { href: "/collaboration", icon: Users, label: "Collaboration" },
    { href: "/founder-profile", icon: UserCircle, label: "Founder Profile" },
    { href: "/autonomy", icon: Bot, label: "Autonomy" },
    { href: "/blockers", icon: ShieldAlert, label: "Blocker Center" },
    { href: "/overview", icon: LayoutDashboard, label: "Classic Overview" },
    { href: "/hq", icon: Box, label: "3D HQ" },
    { href: "/quinn", icon: Brain, label: "Quinn Chat" },
  ];

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden text-foreground selection:bg-primary/30">
      
      {/* Mobile Sidebar Toggle */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 border-b border-border bg-card/80 backdrop-blur z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <span className="font-mono font-bold uppercase tracking-widest text-primary neon-text-primary text-sm">VYBE_HQ</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-border bg-card/95 backdrop-blur flex flex-col transition-transform duration-300 md:relative md:translate-x-0 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="p-5 border-b border-border hidden md:flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center border border-primary/40 text-primary shadow-[0_0_10px_rgba(var(--primary),0.2)]">
            <Activity className="w-5 h-5" />
          </div>
          <h1 className="font-mono font-bold tracking-widest text-sm text-primary neon-text-primary uppercase">VYBE_HQ</h1>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar py-4 px-3 flex flex-col gap-6 pb-24 md:pb-4">
          <nav className="flex flex-col gap-1">
            <p className="px-3 text-[10px] font-mono text-muted-foreground uppercase mb-2 tracking-wider">Primary Operations</p>
            {primaryNavItems.map((item) => (
              <NavItem 
                key={item.href} 
                href={item.href} 
                icon={item.icon} 
                label={item.label} 
                isActive={location === item.href || (item.href !== "/" && location.startsWith(item.href))} 
              />
            ))}
          </nav>

          <div className="border-t border-border/50 pt-4">
            <button 
              onClick={() => setSecondaryNavOpen(!secondaryNavOpen)}
              className="flex items-center justify-between w-full px-3 py-2 text-[10px] font-mono text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
              <span>Secondary Systems</span>
              {secondaryNavOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            {secondaryNavOpen && (
              <nav className="flex flex-col gap-1 mt-2">
                {secondaryNavItems.map((item) => (
                  <NavItem 
                    key={item.href} 
                    href={item.href} 
                    icon={item.icon} 
                    label={item.label} 
                    isActive={location === item.href} 
                  />
                ))}
              </nav>
            )}
          </div>

          {team.length > 0 && (
            <div className="border-t border-border/50 pt-4">
              <p className="px-3 text-[10px] font-mono text-muted-foreground uppercase mb-2 tracking-wider">Executive Roster</p>
              <nav className="flex flex-col gap-1">
                {team.map((exec) => (
                  <Link
                    key={exec.id}
                    href={`/executives/${exec.id}`}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium ${
                      location === `/executives/${exec.id}`
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
                    }`}
                  >
                    <div className="w-2 h-2 rounded-full shadow-[0_0_5px_currentColor]" style={{ backgroundColor: exec.accentColor, color: exec.accentColor }} />
                    <span className="truncate flex-1">{exec.name}</span>
                    <div className={`w-1.5 h-1.5 rounded-full ${execStatusStyle(exec.status).dot}`} />
                  </Link>
                ))}
              </nav>
            </div>
          )}

          <BuildStamp />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-background relative pt-14 md:pt-0 pb-16 md:pb-16 overflow-hidden">
        {/* Background ambient lighting */}
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
        
        <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10 p-4 md:p-6 w-full">
          {children}
        </div>

        {/* Persistent Quinn Command Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-16 glass-panel border-t flex items-center px-4 md:px-8 z-30 justify-between gap-4">
          
          <div className="flex items-center gap-3 w-full max-w-3xl mx-auto">
            {quinn ? (
              <div 
                className="hidden md:flex w-8 h-8 rounded items-center justify-center font-mono text-xs font-bold border shrink-0 shadow-[0_0_10px_currentColor]"
                style={{ backgroundColor: `${quinn.accentColor}20`, color: quinn.accentColor, borderColor: `${quinn.accentColor}50` }}
              >
                {quinn.avatarInitials}
              </div>
            ) : (
              <div className="hidden md:flex w-8 h-8 rounded bg-primary/20 items-center justify-center text-primary border border-primary/50 shrink-0">
                <Brain className="w-4 h-4" />
              </div>
            )}
            
            <form onSubmit={handleSendMessage} className="flex-1 relative flex items-center">
              <input 
                type="text" 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Message Quinn (Chief of Staff)..." 
                className="w-full bg-black/40 border border-white/10 rounded-full pl-4 pr-24 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all shadow-inner"
              />
              <div className="absolute right-1 flex items-center gap-1">
                {speechSupported && (
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="icon" 
                    className={`h-8 w-8 rounded-full ${isDictating ? 'text-destructive animate-pulse bg-destructive/10' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={toggleDictation}
                  >
                    <Mic className="w-4 h-4" />
                  </Button>
                )}
                <Button 
                  type="submit" 
                  disabled={!message.trim() || sendMessage.isPending} 
                  className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/80 shadow-[0_0_10px_rgba(var(--primary),0.5)] p-0 flex items-center justify-center shrink-0 disabled:opacity-50"
                >
                  <Send className="w-3 h-3 ml-0.5" />
                </Button>
              </div>
            </form>
          </div>

          <div className="flex items-center shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-primary transition-colors"
              onClick={() => setPaletteOpen(true)}
              title="Search & commands (⌘K)"
              data-testid="button-command-palette"
            >
              <Search className="w-5 h-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="relative text-muted-foreground hover:text-primary transition-colors"
              onClick={() => setLocation("/quinn")}
              title={unreadCount > 0 ? `${unreadCount} pending approval${unreadCount === 1 ? "" : "s"}` : "No pending approvals"}
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-mono font-bold flex items-center justify-center shadow-[0_0_5px_rgba(var(--accent),1)]">
                  {unreadCount}
                </span>
              )}
            </Button>
          </div>
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onRunCommand={dispatchToQuinn}
      />

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 md:hidden" onClick={() => setMobileMenuOpen(false)} />
      )}
    </div>
  );
}
