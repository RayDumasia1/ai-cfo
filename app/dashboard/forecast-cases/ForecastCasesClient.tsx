"use client";
import Link from "next/link";
import { useRef,useState } from "react";
import { type CaseAssumption,type CaseCalculation,type ForecastCaseType,type ForecastCasesView,type SavedForecastCase } from "@/lib/forecastCases";
import { reviewDateLabel as date,reviewMoneyLabel } from "../forecast-review/ReviewResult";
import CaseComparison,{type CaseColumn} from "./CaseComparison";
const field="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal focus:outline-none";
const primary="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const secondary="rounded-md border border-line px-3 py-2 text-sm text-ink disabled:opacity-50";
const blank={name:"",operation:"amount_multiplier" as CaseAssumption["operation"],value:"",rationale:"",itemIds:[] as string[]};
export default function ForecastCasesClient({initialState}:{initialState:ForecastCasesView}){
  const [state,setState]=useState(initialState),[caseType,setCaseType]=useState<ForecastCaseType>("downside"),[name,setName]=useState("");
  const [assumptions,setAssumptions]=useState<CaseAssumption[]>([]),[draft,setDraft]=useState(blank),[calculation,setCalculation]=useState<CaseCalculation|null>(null);
  const [viewing,setViewing]=useState<SavedForecastCase|null>(null),[busy,setBusy]=useState(false),[needsReload,setNeedsReload]=useState(false);
  const [pending,setPending]=useState<Record<string,unknown>|null>(null),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  const inFlight=useRef(false);
  const base=state.base,locked=busy||!!pending||needsReload;
  function changed(){setCalculation(null);setViewing(null);setNotice(null);}
  async function load(id:string){
    setBusy(true);setError(null);
    try{const r=await fetch(`/api/forecast-cases?baseVersionId=${id}`,{cache:"no-store"});const data=await r.json();if(!r.ok)throw new Error(data.error??"Could not load these cases.");
      setState(data);setAssumptions([]);setName("");setDraft(blank);setCalculation(null);setViewing(null);setNeedsReload(false);
    }catch(e){setError(e instanceof Error?e.message:"Could not load these cases.");setNeedsReload(true);}finally{setBusy(false);}
  }
  function body(action:string){return {action,requestKey:crypto.randomUUID(),baseVersionId:base!.id,caseType,name,assumptions};}
  async function calculate(){
    if(!base||inFlight.current)return;inFlight.current=true;setBusy(true);setError(null);
    try{const r=await fetch("/api/forecast-cases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body("calculate"))});
      const data=await r.json();if(!r.ok)throw new Error(data.error??"Could not calculate this case.");setCalculation(data.calculation);setViewing(null);
    }catch(e){setError(e instanceof Error?e.message:"Could not calculate this case.");}finally{setBusy(false);inFlight.current=false;}
  }
  async function save(request:Record<string,unknown>){
    if(!base||inFlight.current)return;inFlight.current=true;setBusy(true);setError(null);setPending(request);
    try{const r=await fetch("/api/forecast-cases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request)});
      const data=await r.json();if(!r.ok){if(r.status<500){setPending(null);if(r.status===409)setNeedsReload(true);}throw new Error(data.error??"The save response was interrupted.");}
      setPending(null);setNotice(`Case saved as version ${data.version_number}.`);await load(base.id);
    }catch(e){setError(e instanceof Error?e.message:"The save response was interrupted. Retry the same save.");}finally{setBusy(false);inFlight.current=false;}
  }
  function add(event:React.FormEvent){
    event.preventDefault();if(!draft.itemIds.length){setError("Select at least one active base-plan item.");return;}
    if(draft.operation!=="exclude"&&draft.value.trim()===""){setError("Enter the amount percentage or number of days.");return;}
    const value=draft.operation==="exclude"?null:draft.operation==="amount_multiplier"?Number((Number(draft.value)/100).toFixed(6)):Number(draft.value);
    setAssumptions(items=>[...items,{id:crypto.randomUUID(),name:draft.name.trim(),operation:draft.operation,value,itemIds:[...draft.itemIds],rationale:draft.rationale.trim()}]);
    setDraft(blank);changed();setError(null);
  }
  function openSaved(c:SavedForecastCase){setCaseType(c.caseType);setName(c.name);setAssumptions(structuredClone(c.assumptions));setCalculation(null);setViewing(c);setDraft(blank);setNotice(null);setError(null);}
  const currentComparison=calculation??viewing?.calculation??null;
  const columns:CaseColumn[]=(["downside","upside"] as const).flatMap(type=>{
    if(type===caseType&&currentComparison)return [{label:`${type==="downside"?"Downside":"Upside"} ${viewing?"saved case":"preview"}: ${name}`,result:currentComparison.caseResult,date:currentComparison.evaluationDate}];
    const saved=state.cases.find(c=>c.caseType===type&&c.status==="published");
    return saved?[{label:`${type==="downside"?"Downside":"Upside"}: ${saved.name}`,result:saved.calculation.caseResult,date:saved.calculation.evaluationDate}]:[];
  });
  const baseResult=currentComparison?.baseResult??state.baseResult;
  const hasDraft=!!(draft.name.trim()||draft.value.trim()||draft.rationale.trim()||draft.itemIds.length);
  const money=(n:number)=>reviewMoneyLabel(n,base?.currency??"USD");
  return <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
    <Link href="/dashboard/cash-planning" className="text-sm text-teal underline">Back to cash planning</Link>
    <header className="mb-7 mt-4"><h1 className="text-2xl font-medium text-ink">Compare cash-plan cases</h1>
      <p className="mt-2 max-w-3xl text-sm text-dim">Test explicit downside and upside assumptions against the same published base plan. Keep saved versions and see how cash timing, the lowest balance and reserve risk change.</p></header>
    {error&&<p role="alert" className="mb-5 rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-ink">{error}</p>}
    {notice&&<p role="status" className="mb-5 rounded-md border border-line bg-surface p-4 text-sm text-ink">{notice}</p>}
    {pending&&!busy&&<div className="mb-5 rounded-lg border border-line bg-surface p-5"><p className="text-sm text-ink">The response was interrupted. Retry the same save to confirm whether this version was stored. Your assumptions are held here until the result is known.</p><button className={`${primary} mt-3`} type="button" onClick={()=>void save(pending)}>Retry the same save</button></div>}
    {!base?<section className="rounded-lg border border-line bg-surface p-6"><h2 className="text-lg font-medium text-ink">Publish a base cash plan first</h2><p className="mt-2 text-sm text-dim">Saved cases need a shared published starting point, cash dates and source items.</p><Link href="/dashboard/forecast" className="mt-4 inline-flex text-sm text-teal underline">Open weekly cash plan</Link></section>:<div className="space-y-5" aria-busy={busy}>
      <section className="rounded-lg border border-line bg-surface p-5 sm:p-6"><label htmlFor="case-base" className="text-sm font-medium text-ink">1. Choose the published base</label>
        <select id="case-base" className={`${field} mt-2`} disabled={busy||!!pending} value={base.id} onChange={event=>void load(event.target.value)}>{state.bases.map(b=><option key={b.id} value={b.id}>Base plan {b.versionNumber} · Starts {date(b.startDate)} · {b.id===state.currentBaseId?"Current":"Earlier base"}</option>)}</select>
        <p className="mt-2 text-xs text-dim">Changing the base discards unsaved assumptions. Saved cases stay attached to their original base.</p>
        {base.id!==state.currentBaseId&&<p className="mt-3 text-sm text-ink">You’re viewing an earlier base. Choose the current base to save a new case. Earlier cases remain available for comparison.</p>}
        {(state.baseResult?.freshness.startingCash!=="current"||(state.baseResult?.freshness.staleScheduledItemCount??0)>0)&&<p className="mt-3 text-sm text-ink">The source cash balance or scheduled evidence needs refreshing. Check your current cash and source records before relying on these projections.</p>}
        <button className={`${secondary} mt-3`} disabled={busy||!!pending} type="button" onClick={()=>void load(base.id)}>Reload cases and discard unsaved edits</button>
      </section>
      <section className="rounded-lg border border-line bg-surface p-5 sm:p-6"><h2 className="text-lg font-medium text-ink">2. Build a case from explicit assumptions</h2>
        <fieldset disabled={locked} className="mt-4 grid gap-4 sm:grid-cols-2"><legend className="sr-only">Case name and type</legend>
          <label className="text-sm">Case name<input className={`${field} mt-1`} maxLength={120} value={name} onChange={ev=>{setName(ev.target.value);changed();}}/></label>
          <label className="text-sm">Case type<select className={`${field} mt-1`} value={caseType} onChange={ev=>{setCaseType(ev.target.value as ForecastCaseType);changed();}}><option value="downside">Downside</option><option value="upside">Upside</option></select></label>
        </fieldset>
        <p className="mt-3 text-xs text-dim">These labels describe your planning cases. The calculation shows the actual cash effect; it may move either way. Changing an assumption does not change an obligation.</p>
        <form onSubmit={add} className="mt-5 rounded-md border border-line p-4"><fieldset disabled={locked||assumptions.length>=50} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">New assumption</legend>
          <label className="text-sm">Assumption name<input required maxLength={120} className={`${field} mt-1`} value={draft.name} onChange={ev=>setDraft({...draft,name:ev.target.value})}/></label>
          <label className="text-sm">Change<select className={`${field} mt-1`} value={draft.operation} onChange={ev=>setDraft({...draft,operation:ev.target.value as CaseAssumption["operation"],value:""})}><option value="amount_multiplier">Change amount</option><option value="date_shift_days">Move cash date</option><option value="exclude">Exclude from this case</option></select></label>
          {draft.operation!=="exclude"&&<label className="text-sm sm:col-span-2">{draft.operation==="amount_multiplier"?"Percentage of base amount (80 means 20% lower; 120 means 20% higher)":"Days to move (positive is later; negative is earlier)"}
            <input required type="number" min={draft.operation==="amount_multiplier"?0:-365} max={draft.operation==="amount_multiplier"?1000:365} step={draft.operation==="amount_multiplier"?0.0001:1} className={`${field} mt-1`} value={draft.value} onChange={ev=>setDraft({...draft,value:ev.target.value})}/></label>}
          <div className="sm:col-span-2"><p className="text-sm font-medium text-ink">Affected base-plan items</p><div className="mt-2 max-h-60 space-y-2 overflow-y-auto rounded-md border border-line p-3" role="group" aria-label="Affected base-plan items">
            {base.items.filter(i=>["expected","confirmed"].includes(i.status)).map(i=><label key={i.id} className="flex items-start gap-3 text-sm text-ink"><input type="checkbox" className="mt-1 accent-teal" checked={draft.itemIds.includes(i.id)} onChange={ev=>setDraft({...draft,itemIds:ev.target.checked?[...draft.itemIds,i.id]:draft.itemIds.filter(id=>id!==i.id)})}/><span>{i.description}<span className="mt-1 block text-xs text-dim">{i.direction==="inflow"?"Cash in":"Cash out"} · {i.amount===null?"Amount unknown":money(i.amount)} · {i.expectedDate?date(i.expectedDate):"Date unknown"}</span></span></label>)}
            {!base.items.some(i=>["expected","confirmed"].includes(i.status))&&<p className="text-sm text-dim">This base has no active cash items. Update the base plan before creating cases.</p>}
          </div></div>
          <label className="text-sm sm:col-span-2">Why is this assumption reasonable?<textarea required maxLength={2000} className={`${field} mt-1`} value={draft.rationale} onChange={ev=>setDraft({...draft,rationale:ev.target.value})}/></label>
          <div className="flex gap-3 sm:col-span-2"><button className={secondary} type="submit">Add assumption</button>{hasDraft&&<button className={secondary} type="button" onClick={()=>setDraft(blank)}>Clear assumption</button>}</div>
        </fieldset></form>
        <h3 className="mt-5 text-sm font-medium text-ink">Assumptions in this case ({assumptions.length}/50)</h3>
        {assumptions.length===0?<p className="mt-2 text-sm text-dim">No assumptions added. The published base remains the reference.</p>:<ul className="mt-2 divide-y divide-line">{assumptions.map(a=><li key={a.id} className="flex items-start justify-between gap-4 py-3 text-sm text-ink"><div className="min-w-0 break-words"><p className="font-medium">{a.name}</p><p className="mt-1 text-xs text-dim">{a.operation==="exclude"?"Exclude from this case":a.operation==="amount_multiplier"?`${Number(((a.value??0)*100).toFixed(4))}% of base amount`:`Move by ${a.value} days`} · {a.itemIds.map(id=>base.items.find(i=>i.id===id)?.description??"Source item").join(", ")}</p><p className="mt-1 text-xs text-dim">{a.rationale}</p></div><button type="button" className="shrink-0 text-xs text-teal underline disabled:opacity-50" disabled={locked} aria-label={`Remove assumption: ${a.name}`} onClick={()=>{setAssumptions(list=>list.filter(i=>i.id!==a.id));changed();}}>Remove</button></li>)}</ul>}
        {hasDraft&&<p className="mt-4 text-sm text-dim">Add or clear the unfinished assumption before calculating.</p>}
        <div className="mt-5 flex flex-wrap gap-3"><button className={secondary} type="button" disabled={locked||hasDraft||!name.trim()||!assumptions.length} onClick={()=>void calculate()}>Calculate case</button>
          <button className={primary} type="button" disabled={locked||hasDraft||!calculation||base.id!==state.currentBaseId} onClick={()=>void save(body("save"))}>Save case version</button></div>
        {viewing&&<p className="mt-3 text-xs text-dim">Viewing saved version {viewing.versionNumber}. Change assumptions and calculate to save another version.</p>}
      </section>
      <section className="rounded-lg border border-line bg-surface p-5 sm:p-6"><h2 className="mb-4 text-lg font-medium text-ink">3. Compare weekly cash and reserve risk</h2>
        {!columns.length&&<p className="mb-4 text-sm text-dim">Only the base is shown until you calculate or save a downside or upside case.</p>}
        {baseResult&&<CaseComparison base={base} baseResult={baseResult} columns={columns}/>}
        <Link href="/dashboard/forecast" className="mt-5 inline-flex text-sm text-teal underline">Review or update the current base plan</Link>
      </section>
      <section className="rounded-lg border border-line bg-surface p-5 sm:p-6"><h2 className="text-lg font-medium text-ink">Saved case history for this base</h2>
        {state.cases.length===0?<p className="mt-3 text-sm text-dim">No cases saved for this base yet.</p>:<ul className="mt-3 divide-y divide-line">{state.cases.map(c=><li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm text-ink"><div><p>{c.name} · {c.caseType==="downside"?"Downside":"Upside"} · Version {c.versionNumber}</p><p className="mt-1 text-xs text-dim">{c.status==="published"?"Latest saved case of this type":"Earlier saved version"} · {date(c.createdAt.slice(0,10))} · {c.assumptions.length} assumptions</p></div><button className="text-xs text-teal underline disabled:opacity-50" type="button" disabled={locked} onClick={()=>openSaved(c)}>View result and assumptions</button></li>)}</ul>}
        <p className="mt-4 text-xs text-dim">The most recent 50 case versions for the selected base are listed. Saved cases retain their source evidence and calculations.</p>
      </section>
    </div>}
  </div>;
}
