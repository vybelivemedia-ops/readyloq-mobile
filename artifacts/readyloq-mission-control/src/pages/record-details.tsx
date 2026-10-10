import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, ArrowRight, ClipboardList, Clock3, HardDrive, RefreshCw, Search, ShieldAlert, UserRound } from 'lucide-react';
import {
  useGetMissionControlTechnician, useGetMissionControlDeviceSession, useListMissionControlTechnicians,
  getGetMissionControlTechnicianQueryKey,
} from '@workspace/api-client-react';
import { useScope } from '@/pages/console';

const stamp=(value?:string|null)=>value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Not recorded';
function Status({value}:{value:string}){return <span className={`status ${/failed|error|disabled/i.test(value)?'bad':/pending|active/i.test(value)?'warn':''}`}><span className="dot"/>{value}</span>}
function Waiting(){return <div className="surface p-7 space-y-4" data-testid="status-loading"><div className="skeleton h-7 w-1/3"/><div className="skeleton h-16"/><div className="skeleton h-16"/></div>}
function ErrorView({retry}:{retry:()=>void}){return <div className="surface p-10 text-center" role="alert"><ShieldAlert size={28} className="text-[#a8433e] mx-auto"/><h2 className="display text-2xl font-bold mt-4">Record unavailable.</h2><p className="text-[#6b7d79] mt-2">The record may have moved or the service may be temporarily unavailable.</p><button className="btn btn-dark mt-5" onClick={retry} data-testid="button-retry-record">Try again</button></div>}
function Header({eyebrow,title,description,refresh}:{eyebrow:string,title:string,description:string,refresh:()=>void}){return <div className="flex flex-wrap justify-between items-end gap-4 mb-7"><div><div className="eyebrow mb-3">{eyebrow}</div><h1 className="display text-[36px] sm:text-[46px] font-bold leading-none">{title}</h1><p className="text-[#687c78] mt-3">{description}</p></div><button className="btn btn-light" onClick={refresh} data-testid="button-refresh-record"><RefreshCw size={16}/> Refresh</button></div>}
function Pager({page,totalPages,onPage}:{page:number,totalPages:number,onPage:(page:number)=>void}){return <div className="flex items-center justify-between mt-5"><span className="mono text-[10px] text-[#687c78]">PAGE {page} / {Math.max(1,totalPages)}</span><div className="flex gap-2"><button className="btn btn-light" disabled={page<=1} onClick={()=>onPage(page-1)} data-testid="button-prev-technicians">Previous</button><button className="btn btn-light" disabled={page>=totalPages} onClick={()=>onPage(page+1)} data-testid="button-next-technicians">Next</button></div></div>}

export function TechnicianDirectory(){
  const {companyId}=useScope();
  const [search,setSearch]=useState('');const [page,setPage]=useState(1);
  const q=useListMissionControlTechnicians({companyId,search:search.trim()||undefined,page,limit:20});
  return <div className="fade-in"><Header eyebrow="DIRECTORY / FIELD TEAMS" title="Technicians" description="Field users across the platform, scoped by the company selector." refresh={()=>q.refetch()}/>
    <div className="relative max-w-md mb-5"><Search className="absolute left-3 top-3 text-[#788b87]" size={17}/><input className="field pl-10" type="search" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search technicians" data-testid="input-search-technicians"/></div>
    {q.isLoading?<Waiting/>:q.isError?<ErrorView retry={()=>q.refetch()}/>:!q.data?.items.length?<div className="surface p-12 text-center text-[#71817e]" data-testid="status-empty">No technicians found in this scope.</div>:<><div className="surface overflow-hidden">{q.data.items.map(technician=><Link href={`/technicians/${encodeURIComponent(technician.id)}`} className="row-link" key={technician.id} data-testid={`link-technician-${technician.id}`}><span className="w-10 h-10 bg-[#e2eee9] text-[#126b63] rounded-full grid place-items-center font-bold">{technician.name.charAt(0)}</span><span className="flex-1 min-w-0"><span className="font-bold block truncate">{technician.name}</span><span className="text-xs text-[#71827f] block truncate">{technician.companyName} · User ID {technician.id}</span></span><Status value={technician.status}/><ArrowRight size={16} className="hidden sm:block text-[#7a918a]"/></Link>)}</div><Pager page={page} totalPages={q.data.totalPages} onPage={setPage}/></>}
  </div>;
}
export function TechnicianDetail(){
  const {id}=useParams();const userId=id||'';
  const q=useGetMissionControlTechnician(userId);
  const technician=q.data;
  return <div className="fade-in">
    <Link href="/technicians" className="inline-flex items-center gap-2 text-[#126b63] font-bold mb-6" data-testid="link-back-technicians"><ArrowLeft size={16}/> All technicians</Link>
    <Header eyebrow={`FIELD TEAM / ${userId}`} title={technician?.name||'Technician detail'} description="Technician identity, company, activity, and linked inspections." refresh={()=>q.refetch()}/>
    {q.isLoading?<Waiting/>:q.isError||!technician?<ErrorView retry={()=>q.refetch()}/>:<>
      <div className="surface grid sm:grid-cols-2 lg:grid-cols-3 overflow-hidden">{[
        ['Technician user ID',technician.id],['Status',<Status value={technician.status}/>],
        ['Company',<Link href={`/companies/${technician.companyId}`} className="text-[#126b63] inline-flex items-center gap-1 hover:underline" data-testid="link-technician-company">{technician.companyName}<ArrowRight size={13}/></Link>],
        ['Company ID',`#${technician.companyId}`],['Last active',stamp(technician.lastActiveAt)]
      ].map(([label,value])=><div className="p-5 border-r border-b border-[#e5e9e3]" key={String(label)}><div className="label">{label}</div><div className="font-bold break-words">{value}</div></div>)}</div>
      <section className="surface mt-5 overflow-hidden"><div className="p-6 border-b border-[#e5e9e3]"><div className="eyebrow">ACTIVITY / INSPECTIONS</div><h2 className="display text-2xl font-bold mt-2">Linked inspections</h2></div>{technician.inspections.length?technician.inspections.map(inspection=><Link href={`/inspections/${inspection.id}`} className="row-link" key={inspection.id} data-testid={`link-technician-inspection-${inspection.id}`}><span className="w-9 h-9 rounded-lg grid place-items-center bg-[#e6efe9] text-[#126b63]"><ClipboardList size={17}/></span><span className="flex-1 min-w-0"><span className="font-bold block truncate">Inspection #{inspection.id} · {inspection.siteAddress||'Address not recorded'}</span><span className="text-xs text-[#71827f]">{inspection.companyName} · {stamp(inspection.createdAt)}</span></span><Status value={inspection.status}/><ArrowRight size={16}/></Link>):<div className="p-7 text-[#70817e]">No linked inspections returned.</div>}</section>
    </>}
  </div>;
}
function sanitize(detail?:string|null){
  if(!detail)return null;
  return detail
    .replace(/\bBearer\s+\S+/gi,'[credential redacted]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+/g,'[token redacted]')
    .replace(/([?&](?:token|session|key|authorization|secret)=)[^&\s]+/gi,'$1[redacted]')
    .replace(/\b(?:https?:\/\/|data:)[^\s]+/gi,'[URL redacted]')
    .slice(0,400);
}
export function SessionUser({userId}:{userId:string|null}){
  const q=useGetMissionControlTechnician(userId||'',{query:{queryKey:getGetMissionControlTechnicianQueryKey(userId||''),enabled:!!userId,retry:false}});
  if(!userId)return <span>Not recorded</span>;
  if(q.data)return <Link href={`/technicians/${encodeURIComponent(userId)}`} className="text-[#126b63] inline-flex items-center gap-1 hover:underline" data-testid="link-session-technician">{q.data.name} · {userId}<ArrowRight size={13}/></Link>;
  return <span data-testid="text-session-user-id">{userId}{q.isLoading?' · Checking technician record…':''}</span>;
}
export function DeviceSessionDetail(){
  const {id}=useParams();const sessionId=Number(id);const q=useGetMissionControlDeviceSession(sessionId);
  const session=q.data;
  return <div className="fade-in">
    <Link href={session?`/inspections/${session.inspectionId}`:'/inspections'} className="inline-flex items-center gap-2 text-[#126b63] font-bold mb-6" data-testid="link-back-session"><ArrowLeft size={16}/> {session?'Back to inspection':'All inspections'}</Link>
    <Header eyebrow={`DEVICE / SESSION ${id}`} title={`Session #${id}`} description="A diagnostic timeline of recorded device activity. Credentials and media URLs are never shown." refresh={()=>q.refetch()}/>
    {q.isLoading?<Waiting/>:q.isError||!session?<ErrorView retry={()=>q.refetch()}/>:<>
      <div className="surface grid sm:grid-cols-2 lg:grid-cols-3 overflow-hidden">{[
        ['Session ID',`#${session.id}`],
        ['Inspection',<Link href={`/inspections/${session.inspectionId}`} className="text-[#126b63] inline-flex items-center gap-1 hover:underline" data-testid="link-session-inspection">#{session.inspectionId}<ArrowRight size={13}/></Link>],
        ['Company',<Link href={`/companies/${session.companyId}`} className="text-[#126b63] inline-flex items-center gap-1 hover:underline" data-testid="link-session-company">{session.companyName} · #{session.companyId}<ArrowRight size={13}/></Link>],
        ['User ID',<SessionUser userId={session.userId}/>],['Opened',stamp(session.createdAt)],['Expires',stamp(session.expiresAt)],['Recorded events',session.eventCount]
      ].map(([label,value])=><div className="p-5 border-r border-b border-[#e5e9e3]" key={String(label)}><div className="label">{label}</div><div className="font-bold break-words">{value}</div></div>)}</div>
      <section className="surface overflow-hidden mt-5"><div className="p-6 border-b border-[#e5e9e3] flex gap-3 items-center"><HardDrive size={20} className="text-[#126b63]"/><div><div className="eyebrow">DEVICE / RECORDED ACTIVITY</div><h2 className="display text-2xl font-bold mt-2">Event timeline</h2></div></div>{session.events.length?session.events.map((event,index)=><div className="row-link items-start" key={`${event.createdAt}-${index}`} data-testid={`row-session-event-${index}`}><Clock3 size={17} className="text-[#126b63] mt-1 shrink-0"/><div className="flex-1 min-w-0"><div className="font-bold break-words">{event.type}</div>{sanitize(event.detail)&&<p className="text-[#647975] text-sm break-words whitespace-pre-wrap mt-1">{sanitize(event.detail)}</p>}<div className="mono text-[10px] text-[#82938f] mt-2">{stamp(event.createdAt)}</div></div></div>):<div className="p-7 text-[#70817e]">No events returned for this session.</div>}</section>
    </>}
  </div>;
}