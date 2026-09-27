import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, RefreshCw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import {
  useGetMissionControlCompany, useRequestMissionControlApproval, useListMissionControlApprovals,
  useDecideMissionControlApproval, getGetMissionControlCompanyQueryKey
} from '@workspace/api-client-react';
import type { MissionControlApproval } from '@workspace/api-client-react';

const stamp=(value?:string|null)=>value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Not recorded';
const errorText=(error:unknown)=>error instanceof Error?error.message:'The request could not be completed. Try again.';
const actionLabel=(action:string)=>({suspend:'Suspend company',enable:'Enable company',beta_enable:'Enable beta access',beta_disable:'Disable beta access'}[action]||action);
const impact=(action:string)=>action==='suspend'?'Suspending this company blocks its users from tenant access. Existing records remain intact. A separate approved enable request can reverse it.':action==='enable'?'Enabling this company restores tenant access. A separate approved suspend request can reverse it.':action==='beta_disable'?'Disabling beta access prevents this user from using beta features. Their records remain intact. A separate approved enable request can reverse it.':'Enabling beta access permits this user to use beta features. A separate approved disable request can reverse it.';

type Action='suspend'|'enable'|'beta_enable'|'beta_disable';
function RequestForm({targetType,targetId,targetName,action,onClose}:{targetType:'company'|'user';targetId:string;targetName:string;action:Action;onClose:()=>void}){
  const [reason,setReason]=useState('');
  const [success,setSuccess]=useState<number|null>(null);
  const mutation=useRequestMissionControlApproval();
  const qc=useQueryClient();
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#142b30]/65 p-4" onClick={onClose}>
    <div className="surface w-full max-w-lg p-6 sm:p-8 max-h-[90dvh] overflow-auto" role="dialog" aria-modal="true" aria-label="Request access change" onClick={e=>e.stopPropagation()}>
      <div className="flex items-center justify-between"><span className="eyebrow">CONTROL / ACCESS REQUEST</span><button type="button" onClick={onClose} aria-label="Close request" data-testid="button-close-access-request"><X size={19}/></button></div>
      {success!==null?<div className="mt-7"><div className="rounded-xl w-12 h-12 grid place-items-center bg-[#e2f0e9] text-[#126b63]"><Check/></div><h2 className="display text-3xl font-bold mt-5">Request queued.</h2><p className="text-[#637875] mt-3">Request #{success} is pending. Access has <strong>not changed</strong>. A different super-admin must review it before any effect takes place.</p><div className="flex flex-wrap gap-2 mt-6"><Link href="/approvals" className="btn btn-primary" data-testid="link-review-request" onClick={onClose}>View approvals <ArrowRight size={16}/></Link><button className="btn btn-light" onClick={onClose} data-testid="button-done-request">Done</button></div></div>:
      <form onSubmit={e=>{e.preventDefault();if(!reason.trim())return;mutation.mutate({data:{targetType,targetId,action,reason:reason.trim()}},{onSuccess:approval=>{setSuccess(approval.id);qc.invalidateQueries({queryKey:['/api/mission-control/approvals']});qc.invalidateQueries({queryKey:['/api/mission-control/audit']})}})}}>
        <h2 className="display text-3xl font-bold mt-5">{actionLabel(action)}</h2>
        <p className="text-[#627775] mt-2">{targetName}</p>
        <div className="rounded-xl border border-[#e5d1ac] bg-[#fbf4e7] p-4 mt-6"><div className="font-bold text-[#725126] flex items-center gap-2"><ShieldAlert size={17}/> Impact & reversibility</div><p className="text-sm text-[#725b3e] leading-relaxed mt-2">{impact(action)}</p></div>
        <div className="rounded-xl border border-[#cdded6] bg-[#eef5ef] p-4 mt-3"><div className="font-bold text-[#126b63] flex items-center gap-2"><ShieldCheck size={17}/> Second-admin approval required</div><p className="text-sm text-[#496d65] mt-2">Submitting only creates a pending request. Another super-admin must approve it. Approval immediately applies the access change; rejection leaves access unchanged.</p></div>
        <label className="label mt-6" htmlFor="access-reason">Why is this change needed?</label>
        <textarea id="access-reason" className="field min-h-28" maxLength={1000} required value={reason} onChange={e=>setReason(e.target.value)} placeholder="Give the reviewing admin enough context to decide." data-testid="input-access-reason"/>
        {mutation.isError&&<p className="text-[#a8433e] mt-3" role="alert" data-testid="status-request-error">{errorText(mutation.error)}</p>}
        <div className="flex flex-wrap gap-2 mt-5"><button type="submit" className="btn btn-primary" disabled={!reason.trim()||mutation.isPending} data-testid="button-submit-access-request">{mutation.isPending?'Submitting…':'Request approval'} <ArrowRight size={16}/></button><button type="button" className="btn btn-light" onClick={onClose} data-testid="button-cancel-access-request">Cancel</button></div>
      </form>}
    </div>
  </div>;
}
function Status({value}:{value:string}){return <span className={`status ${/pending|queued/.test(value)?'warn':/suspended|rejected|disabled/.test(value)?'bad':''}`}><span className="dot"/>{value.replaceAll('_',' ')}</span>}
function Loading(){return <div className="surface p-7 space-y-4" data-testid="status-loading"><div className="skeleton h-8 w-1/3"/><div className="skeleton h-16"/><div className="skeleton h-16"/></div>}
function Problem({retry}:{retry:()=>void}){return <div className="surface p-9 text-center" role="alert"><ShieldAlert className="mx-auto text-[#a8433e]"/><h2 className="display text-2xl font-bold mt-3">This view could not be loaded.</h2><button className="btn btn-dark mt-5" onClick={retry} data-testid="button-retry-access">Try again</button></div>}

export function CompanyAccessDetail(){
  const {id}=useParams();const companyId=Number(id);
  const q=useGetMissionControlCompany(companyId);
  const [request,setRequest]=useState<{targetType:'company'|'user';targetId:string;targetName:string;action:Action}|null>(null);
  const c=q.data;
  return <div className="fade-in">
    <Link href="/companies" className="inline-flex items-center gap-2 text-[#126b63] font-bold mb-6" data-testid="link-back-companies"><ArrowLeft size={16}/> All companies</Link>
    <div className="flex items-end justify-between gap-4 mb-7"><div><div className="eyebrow mb-3">TENANT / {id}</div><h1 className="display text-[36px] sm:text-[46px] leading-none font-bold">{c?.name||'Company detail'}</h1><p className="text-[#697d7a] mt-3">Access requests are reviewed by a second administrator before taking effect.</p></div><button className="btn btn-light" onClick={()=>q.refetch()} aria-label="Refresh company" data-testid="button-refresh-company"><RefreshCw size={17}/></button></div>
    {q.isLoading?<Loading/>:q.isError||!c?<Problem retry={()=>q.refetch()}/>:<>
      <div className="surface grid grid-cols-2 lg:grid-cols-4 overflow-hidden">{[['Access',<Status value={c.accessStatus}/>],['Owner',c.owner?.name],['Users',c.userCount],['Technicians',c.technicianCount],['Inspections',c.inspectionCount],['Created',stamp(c.createdAt)],['Last activity',stamp(c.lastActivityAt)],['Company ID',`#${c.id}`]].map(([label,value])=><div key={String(label)} className="p-5 border-r border-b border-[#e3e9e2]"><div className="label">{label}</div><div className="font-bold break-words">{value||'Not recorded'}</div></div>)}</div>
      <div className="grid lg:grid-cols-[.85fr_1.15fr] gap-5 mt-5">
        <section className="surface panel"><div className="eyebrow">CONTROL / COMPANY</div><h2 className="display text-2xl font-bold mt-2">Tenant access</h2><p className="text-[#687b7a] mt-3">Current state: <Status value={c.accessStatus}/></p><p className="text-sm text-[#627775] leading-relaxed mt-5">{impact(c.accessStatus==='enabled'?'suspend':'enable')}</p><button className={`btn mt-6 ${c.accessStatus==='enabled'?'btn-danger':'btn-primary'}`} onClick={()=>setRequest({targetType:'company',targetId:String(c.id),targetName:c.name,action:c.accessStatus==='enabled'?'suspend':'enable'})} data-testid="button-request-company-access">Request {c.accessStatus==='enabled'?'suspension':'enablement'} <ArrowRight size={15}/></button><p className="text-xs text-[#788b86] mt-3">No immediate change. Approval by a different administrator is required.</p></section>
        <section className="surface overflow-hidden"><div className="p-6"><div className="eyebrow">PEOPLE / BETA ACCESS</div><h2 className="display text-2xl font-bold mt-2">Company users</h2><p className="text-sm text-[#697c79] mt-2">Choose a user to request a reversible beta-access change.</p></div>{c.users.length?c.users.map(user=><div className="row-link" key={user.id} data-testid={`row-company-user-${user.id}`}><div className="flex-1 min-w-0"><div className="font-bold truncate">{user.name}</div><div className="text-xs text-[#71827f] truncate">{user.email} · {user.role||'User'}</div></div><Status value={user.betaAccessEnabled?'Enabled':'Disabled'}/><button className="btn btn-light !text-xs" onClick={()=>setRequest({targetType:'user',targetId:user.id,targetName:`${user.name} (${user.email})`,action:user.betaAccessEnabled?'beta_disable':'beta_enable'})} data-testid={`button-request-user-access-${user.id}`}>Request {user.betaAccessEnabled?'disable':'enable'}</button></div>):<div className="p-6 text-[#728480]">No users recorded.</div>}</section>
      </div>
      <section className="surface overflow-hidden mt-5"><div className="p-6"><div className="eyebrow">ACTIVITY</div><h2 className="display text-2xl font-bold mt-2">Recent inspections</h2></div>{c.recentInspections.length?c.recentInspections.map(inspection=><Link href={`/inspections/${inspection.id}`} className="row-link" key={inspection.id} data-testid={`link-company-inspection-${inspection.id}`}><span className="mono text-xs text-[#126b63]">#{inspection.id}</span><span className="flex-1 font-semibold truncate">{inspection.siteAddress||'Address not recorded'}</span><Status value={inspection.status}/><ArrowRight size={15}/></Link>):<div className="p-6 text-[#728480]">No recent inspections.</div>}</section>
    </>}
    {request&&<RequestForm {...request} onClose={()=>setRequest(null)}/>}
  </div>;
}

type Target={type:'company'|'user';id:string;action:string;reason:string};
function targetOf(approval:MissionControlApproval):Target|null{
  const enriched=approval as MissionControlApproval&{targetType?:string;targetId?:string;action?:string;reason?:string};
  if((enriched.targetType==='company'||enriched.targetType==='user')&&enriched.targetId) return {type:enriched.targetType,id:enriched.targetId,action:enriched.action||'',reason:enriched.reason||approval.request};
  const match=/^(suspend|enable|beta_enable|beta_disable) (company|user) ([^:]+): (.*)$/s.exec(approval.request);
  return match?{action:match[1],type:match[2] as 'company'|'user',id:match[3],reason:match[4]}:null;
}
function ApprovalCard({item,onDecide}:{item:MissionControlApproval;onDecide:(decision:'approve'|'reject',id:number)=>void}){
  const target=targetOf(item);
  return <article className="surface panel" data-testid={`card-approval-${item.id}`}>
    <div className="flex justify-between gap-3"><span className="eyebrow">{item.type.replaceAll('_',' ')} / #{item.id}</span><Status value={item.status}/></div>
    <h2 className="display text-2xl font-bold mt-5">{target?actionLabel(target.action):'Approval request'}</h2>
    {target?<div className="mt-5 rounded-xl bg-[#eff3ed] p-4"><div className="label">Affected {target.type}</div><div className="font-bold break-all">{target.type==='company'?'Company':'User'} #{target.id}</div>{target.type==='company'&&<Link href={`/companies/${target.id}`} className="inline-flex items-center gap-1 text-[#126b63] text-xs font-bold mt-3 hover:underline" data-testid={`link-approval-target-${item.id}`}>Open company detail <ArrowRight size={13}/></Link>}{target.type==='user'&&<div className="text-xs text-[#6c807b] mt-2">User access is managed in the company detail. No separate user-detail route is exposed.</div>}</div>:<p className="text-[#5b7370] mt-4 break-words">{item.request}</p>}
    {target&&<><div className="label mt-5">Request reason</div><p className="text-sm text-[#536b68] leading-relaxed whitespace-pre-wrap">{target.reason}</p><div className="rounded-lg bg-[#fbf4e7] p-4 mt-5 text-sm text-[#725b3e]"><strong>Effect if approved:</strong> {impact(target.action)}</div></>}
    <div className="text-xs text-[#748784] mt-5">Requested by {item.requestedBy} · {stamp(item.createdAt)}</div>
    {item.note&&<p className="bg-[#edf2ec] rounded-lg p-3 text-sm mt-4">Decision note: {item.note}</p>}
    {item.status==='pending'&&<div className="flex gap-2 mt-5"><button className="btn btn-primary" onClick={()=>onDecide('approve',item.id)} data-testid={`button-approve-${item.id}`}><Check size={16}/> Review & approve</button><button className="btn btn-light" onClick={()=>onDecide('reject',item.id)} data-testid={`button-reject-${item.id}`}><X size={16}/> Reject</button></div>}
  </article>;
}
export function AccessApprovals(){
  const [status,setStatus]=useState('pending');const [page,setPage]=useState(1);
  const q=useListMissionControlApprovals({status:status||undefined,page,limit:20});
  const mutation=useDecideMissionControlApproval();const qc=useQueryClient();
  const [choice,setChoice]=useState<{id:number;decision:'approve'|'reject'}|null>(null);const [note,setNote]=useState('');
  const selected=choice?q.data?.items.find(a=>a.id===choice.id):undefined;const target=selected?targetOf(selected):null;
  return <div className="fade-in"><div className="flex flex-wrap items-end justify-between gap-5 mb-7"><div><div className="eyebrow mb-3">GOVERNANCE / DECISIONS</div><h1 className="display text-[36px] sm:text-[46px] leading-none font-bold">Approvals</h1><p className="text-[#687b78] mt-3 max-w-xl">Second-admin review for access changes. Approval applies the change immediately, atomically; rejection leaves access unchanged.</p></div><button className="btn btn-light" onClick={()=>q.refetch()} data-testid="button-refresh-approvals"><RefreshCw size={16}/> Refresh</button></div>
    <div className="flex gap-2 overflow-x-auto pb-2 mb-4">{['pending','approved','rejected',''].map(s=><button key={s} className={`btn whitespace-nowrap ${status===s?'btn-dark':'btn-light'}`} onClick={()=>{setStatus(s);setPage(1)}} data-testid={`button-approval-filter-${s||'all'}`}>{s||'All'}</button>)}</div>
    {q.isLoading?<Loading/>:q.isError?<Problem retry={()=>q.refetch()}/>:!q.data?.items.length?<div className="surface p-12 text-center"><ShieldCheck className="mx-auto text-[#126b63]"/><h2 className="display text-2xl font-bold mt-3">Queue clear.</h2><p className="text-[#6d807d] mt-2">No requests in this view.</p></div>:<><div className="grid lg:grid-cols-2 gap-4">{q.data.items.map(item=><ApprovalCard item={item} key={item.id} onDecide={(decision,id)=>{setChoice({id,decision});setNote('')}}/>)}</div><div className="flex items-center justify-between mt-5 text-sm"><span className="mono text-[10px]">PAGE {page} / {q.data.totalPages}</span><div className="flex gap-2"><button className="btn btn-light" disabled={page<=1} onClick={()=>setPage(p=>p-1)} data-testid="button-prev-approvals">Previous</button><button className="btn btn-light" disabled={page>=q.data.totalPages} onClick={()=>setPage(p=>p+1)} data-testid="button-next-approvals">Next</button></div></div></>}
    {choice&&<div className="fixed inset-0 z-50 grid place-items-center bg-[#142b30]/65 p-4" onClick={()=>setChoice(null)}><div className="surface w-full max-w-lg p-6 sm:p-8 max-h-[90dvh] overflow-auto" role="dialog" aria-modal="true" aria-label="Confirm access decision" onClick={e=>e.stopPropagation()}><div className="flex justify-between"><span className="eyebrow">SECOND-ADMIN DECISION / #{choice.id}</span><button onClick={()=>setChoice(null)} aria-label="Close decision" data-testid="button-close-decision"><X size={19}/></button></div><h2 className="display text-3xl font-bold mt-5">{choice.decision==='approve'?'Apply this change?':'Reject this request?'}</h2>{target&&<div className="mt-5 rounded-lg border border-[#e0e7df] p-4"><div className="font-bold">{actionLabel(target.action)} · {target.type} #{target.id}</div><p className="text-sm text-[#657976] mt-2">{target.reason}</p></div>}
      <div className={`rounded-lg p-4 mt-4 text-sm ${choice.decision==='approve'?'bg-[#fbf0df] text-[#725126]':'bg-[#edf3ec] text-[#45695d]'}`}><strong>{choice.decision==='approve'?'Immediate effect:':'No access change:'}</strong> {choice.decision==='approve'?target?impact(target.action):'Approval immediately executes the access change represented by this request. Verify the request details before proceeding.':'Rejecting records your decision and leaves current access unchanged.'}</div>
      <p className="text-xs text-[#687d78] mt-3">A different administrator must decide this request. You cannot approve your own request.</p><label className="label mt-6" htmlFor="decision-note">Decision note (required)</label><textarea id="decision-note" className="field min-h-24" value={note} onChange={e=>setNote(e.target.value)} data-testid="input-decision-note" placeholder="Explain your decision."/>
      {mutation.isError&&<p className="text-[#a8433e] mt-3" role="alert" data-testid="status-decision-error">{errorText(mutation.error)}</p>}
      <div className="flex gap-2 mt-5"><button className={`btn ${choice.decision==='approve'?'btn-danger':'btn-dark'}`} disabled={!note.trim()||mutation.isPending} onClick={()=>mutation.mutate({id:choice.id,data:{decision:choice.decision,note:note.trim()}},{onSuccess:()=>{setChoice(null);qc.invalidateQueries({queryKey:['/api/mission-control/approvals']});qc.invalidateQueries({queryKey:['/api/mission-control/companies']});qc.invalidateQueries({queryKey:['/api/mission-control/technicians']});qc.invalidateQueries({queryKey:['/api/mission-control/audit']});qc.invalidateQueries({queryKey:['/api/mission-control/overview']});qc.invalidateQueries({predicate:query=>String(query.queryKey[0]).startsWith('/api/mission-control/companies/')});if(target?.type==='company')qc.invalidateQueries({queryKey:getGetMissionControlCompanyQueryKey(Number(target.id))})}})} data-testid="button-confirm-decision">{mutation.isPending?'Saving…':choice.decision==='approve'?'Approve & apply now':'Reject request'}</button><button className="btn btn-light" onClick={()=>setChoice(null)} data-testid="button-cancel-decision">Cancel</button></div></div></div>}
  </div>;
}