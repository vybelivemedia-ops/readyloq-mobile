import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import { PublicLanding, Gate, Shell, Overview, Companies, Inspections, Incidents, IncidentDetail, Audit, Agents } from '@/pages/console';
import { CompanyAccessDetail, AccessApprovals } from '@/pages/access-workflow';
import { InspectionDiagnostic } from '@/pages/inspection-diagnostic';
import { TechnicianDirectory, TechnicianDetail, DeviceSessionDetail } from '@/pages/record-details';

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
function stripBase(path:string):string {return basePath && path.startsWith(basePath) ? path.slice(basePath.length)||'/' : path;}
if(!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:15000,retry:1,refetchOnWindowFocus:true}}});
const clerkAppearance={
  theme:shadcn, cssLayerName:'clerk',
  options:{logoPlacement:'inside' as const,logoLinkUrl:basePath||'/',logoImageUrl:`${window.location.origin}${basePath}/logo.svg`},
  variables:{colorPrimary:'#126b63',colorForeground:'#20343a',colorMutedForeground:'#627775',colorDanger:'#a8433e',colorBackground:'#fbfaf5',colorInput:'#f7f7f0',colorInputForeground:'#20343a',colorNeutral:'#cbd7d1',fontFamily:'DM Sans, sans-serif',borderRadius:'12px'},
  elements:{rootBox:'w-full flex justify-center',cardBox:'bg-[#fbfaf5] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#d3ddd5]',card:'!shadow-none !border-0 !bg-transparent !rounded-none',footer:'!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle:'!text-[#20343a] !font-bold',headerSubtitle:'!text-[#627775]',socialButtonsBlockButtonText:'!text-[#20343a]',formFieldLabel:'!text-[#20343a]',footerActionLink:'!text-[#126b63]',footerActionText:'!text-[#627775]',dividerText:'!text-[#627775]',identityPreviewEditButton:'!text-[#126b63]',formFieldSuccessText:'!text-[#126b63]',alertText:'!text-[#a8433e]',
    logoBox:'!justify-start',logoImage:'!h-10',socialButtonsBlockButton:'!border-[#cbd7d1]',formButtonPrimary:'!bg-[#126b63] !text-[#fbfaf5]',formFieldInput:'!bg-[#f7f7f0] !text-[#20343a] !border-[#cbd7d1]',footerAction:'!bg-transparent',dividerLine:'!bg-[#cbd7d1]',alert:'!bg-[#f9e8e2]',otpCodeFieldInput:'!text-[#20343a]',formFieldRow:'!text-[#20343a]',main:'!text-[#20343a]'}
};
function AuthFrame({children,signup=false}:{children:ReactNode,signup?:boolean}) {return <div className="min-h-[100dvh] grid lg:grid-cols-2 bg-[#e9eee8]"><div className="hidden lg:flex bg-[#20343a] text-[#f3f1e9] p-14 flex-col justify-between"><div className="display text-2xl font-extrabold">readyloq<span className="text-[#e8ba69]">.</span><span className="mono text-[10px] ml-3 text-[#abc1bc]">MISSION CONTROL</span></div><div><div className="eyebrow !text-[#e8ba69]">PRIVATE OPERATIONS</div><h1 className="display text-[clamp(3.5rem,5.5vw,7rem)] font-bold leading-[.96] mt-5">{signup?'Identity first. Access by invitation.':'The signal, without the noise.'}</h1><p className="text-[#b5cac5] text-lg mt-7 max-w-md">{signup?'Account creation does not grant super-admin privileges. Platform access is assigned separately.':'A secure operating surface for the people keeping ReadyLoq moving.'}</p></div><div className="mono text-[10px] text-[#89a39f]">READYLOQ / RESTRICTED ACCESS</div></div><div className="flex flex-col items-center justify-center p-5 sm:p-10"><div className="max-w-[440px] w-full"><div className="eyebrow mb-6">SECURE ENTRY / {signup?'CREATE ACCOUNT':'SIGN IN'}</div>{children}<div className="text-center mt-6 text-xs text-[#657c78]">Identity verification does not grant administrator access.</div></div></div></div>}
function SignInPage(){return <AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={basePath||'/'}/></AuthFrame>}
function SignUpPage(){return <AuthFrame signup><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={basePath||'/'}/></AuthFrame>}
function ClerkQueryClientCacheInvalidator(){const {addListener}=useClerk();const qc=useQueryClient();const prev=useRef<string|null|undefined>(undefined);useEffect(()=>{const unsubscribe=addListener(({user})=>{const id=user?.id??null;if(prev.current!==undefined&&prev.current!==id)qc.clear();prev.current=id});return unsubscribe},[addListener,qc]);return null}
function Protected({children}:{children:ReactNode}){return <><Show when="signed-in"><Gate><Shell>{children}</Shell></Gate></Show><Show when="signed-out"><PublicLanding/></Show></>}
function Home(){return <><Show when="signed-in"><Gate><Shell><Overview/></Shell></Gate></Show><Show when="signed-out"><PublicLanding/></Show></>}
function RoutedErrorBoundary({children}:{children:ReactNode}){const [location]=useLocation();return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>}
function Routes(){return <RoutedErrorBoundary><Switch>
  <Route path="/" component={Home}/>
  <Route path="/sign-in/*?" component={SignInPage}/>
  <Route path="/sign-up/*?" component={SignUpPage}/>
  <Route path="/companies/:id">{<Protected><CompanyAccessDetail/></Protected>}</Route>
  <Route path="/companies">{<Protected><Companies/></Protected>}</Route>
  <Route path="/technicians/:id">{<Protected><TechnicianDetail/></Protected>}</Route>
  <Route path="/technicians">{<Protected><TechnicianDirectory/></Protected>}</Route>
  <Route path="/device-sessions/:id">{<Protected><DeviceSessionDetail/></Protected>}</Route>
  <Route path="/inspections/:id">{<Protected><InspectionDiagnostic/></Protected>}</Route>
  <Route path="/inspections">{<Protected><Inspections/></Protected>}</Route>
  <Route path="/incidents/:id">{<Protected><IncidentDetail/></Protected>}</Route>
  <Route path="/incidents">{<Protected><Incidents/></Protected>}</Route>
  <Route path="/audit">{<Protected><Audit/></Protected>}</Route>
  <Route path="/agents">{<Protected><Agents/></Protected>}</Route>
  <Route path="/approvals">{<Protected><AccessApprovals/></Protected>}</Route>
  <Route component={NotFound}/>
</Switch></RoutedErrorBoundary>}
function ClerkProviderWithRoutes(){const [,setLocation]=useLocation();return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{signIn:{start:{title:'Welcome back',subtitle:'Sign in to ReadyLoq Mission Control'}},signUp:{start:{title:'Create your account',subtitle:'Account creation does not grant platform access'}}}} routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}><QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator/><Routes/></QueryClientProvider></ClerkProvider>}
function App(){return <WouterRouter base={basePath}><ClerkProviderWithRoutes/></WouterRouter>}
export default App;