"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OwnerReviewState, ReviewQueueItem, SavedOwnerReview } from "@/lib/forecastReviewWorkflow";
import { MATCHING_POLICY } from "@/lib/forecastReviewWorkflow";
import type { StoredForecastAllocation } from "@/lib/forecastReviewStorage";
import type { ForecastVarianceReviewResult } from "@/lib/forecastVariance";
import type { ForecastCategory } from "@/lib/cashForecast";
import { forecastCategoriesFor } from "@/lib/forecastWorkflow";
import ReviewResult, { reviewDateLabel as date, reviewMoneyLabel } from "./ReviewResult";

const field="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal focus:outline-none";
const primary="rounded-md bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const secondary="rounded-md border border-line px-3 py-2 text-sm text-ink disabled:opacity-50";
type Queue={weeks:ReviewQueueItem[];hasPublishedPlan:boolean;firstReviewDate?:string};
type Pending={body:Record<string,unknown>;kind:"save"|"actual"};
type ActualForm={description:string;amount:string;cashDate:string;direction:"inflow"|"outflow";category:ForecastCategory;note:string;correctionId:string|null};
type DecisionForm={resolution:StoredForecastAllocation["resolution"];plannedItemId:string;actualEventId:string;plannedAmount:string;actualAmount:string;rationale:string};
const blankDecision:DecisionForm={resolution:"matched",plannedItemId:"",actualEventId:"",plannedAmount:"",actualAmount:"",rationale:""};
const numberOrNull=(v:string)=>v.trim()===""?null:Number(v);

export default function ForecastReviewClient({initialQueue}:{initialQueue:Queue}) {
  const [queue,setQueue]=useState(initialQueue),[selected,setSelected]=useState<ReviewQueueItem|null>(null);
  const [state,setState]=useState<OwnerReviewState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [opening,setOpening]=useState(""),[closing,setClosing]=useState(""),[allocations,setAllocations]=useState<StoredForecastAllocation[]>([]);
  const [actual,setActual]=useState<ActualForm>({description:"",amount:"",cashDate:"",direction:"inflow",category:"other_cash_in",note:"",correctionId:null});
  const [decision,setDecision]=useState<DecisionForm>(blankDecision),[computed,setComputed]=useState<ForecastVarianceReviewResult|null>(null);
  const [dirty,setDirty]=useState(false),[pending,setPending]=useState<Pending|null>(null),[needsReload,setNeedsReload]=useState(false);
  const [activityConfirmed,setActivityConfirmed]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [historyReview,setHistoryReview]=useState<SavedOwnerReview|null>(null);
  const inFlight=useRef(false),sequence=useRef(0);

  const loadWeek=useCallback(async(week:ReviewQueueItem,preserve=false)=>{
    const request=++sequence.current;setBusy(true);setError(null);
    try{
      const r=await fetch(`/api/forecast-review?versionId=${week.versionId}&weekStart=${week.weekStart}`,{cache:"no-store"});
      const data=await r.json();if(!r.ok)throw new Error(data.error??"Could not load this week.");
      if(request!==sequence.current)return;
      const next=data as OwnerReviewState;setSelected(week);setState(next);setHistoryReview(next.latest);setNeedsReload(false);setComputed(null);
      if(!preserve){setOpening(next.latest?.openingCash==null?"":String(next.latest.openingCash));setClosing(next.latest?.closingCash==null?"":String(next.latest.closingCash));
        setAllocations(next.latest?.allocations??[]);setActivityConfirmed(next.latest?.activityConfirmed===true&&!next.latest.evidenceChanged);setDirty(false);setDecision(blankDecision);}
      setActual({description:"",amount:"",cashDate:week.weekStart,direction:"inflow",category:"other_cash_in",note:"",correctionId:null});
    }catch(e){if(request===sequence.current){setError(e instanceof Error?e.message:"Could not load this week.");setNeedsReload(true);}}
    finally{if(request===sequence.current)setBusy(false);}
  },[]);
  useEffect(()=>{if(initialQueue.weeks[0])void loadWeek(initialQueue.weeks[0]);},[initialQueue,loadWeek]);
  function changed(){setDirty(true);setComputed(null);setNotice(null);}
  async function viewHistory(reviewId:string){
    if(!selected||busy||pending)return;setBusy(true);setError(null);
    try{const r=await fetch(`/api/forecast-review?versionId=${selected.versionId}&weekStart=${selected.weekStart}&reviewId=${reviewId}`,{cache:"no-store"});
      const data=await r.json();if(!r.ok||!data.latest)throw new Error(data.error??"Could not load that saved revision.");setHistoryReview(data.latest);
    }catch(e){setError(e instanceof Error?e.message:"Could not load that saved revision.");}finally{setBusy(false);}
  }
  async function sendWrite(request:Pending) {
    if(inFlight.current||!selected)return;inFlight.current=true;setBusy(true);setError(null);setPending(request);
    try{
      const r=await fetch("/api/forecast-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request.body)});
      const data=await r.json();
      if(!r.ok){
        if(r.status<500){setPending(null);if(r.status===409)setNeedsReload(true);}
        throw new Error(data.error??"The response was interrupted. Retry the same request.");
      }
      setPending(null);
      if(request.kind==="save"){
        setNotice(`Review saved as revision ${data.revision}.`);setComputed(data.result);
        await loadWeek(selected);
        try{const q=await fetch("/api/forecast-review",{cache:"no-store"});if(q.ok)setQueue(await q.json());}catch{/* Saved review remains visible if the queue refresh fails. */}
      }else{changed();setActivityConfirmed(false);setNotice("Cash entry saved. Check the match decisions before saving the weekly review.");await loadWeek(selected,true);}
    }catch(e){setError(e instanceof Error?e.message:"The response was interrupted. Retry the same request.");}
    finally{inFlight.current=false;setBusy(false);}
  }
  async function calculate(){
    if(!selected||!state||inFlight.current)return;inFlight.current=true;setBusy(true);setError(null);
    try{
      const r=await fetch("/api/forecast-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(reviewBody("calculate"))});
      const data=await r.json();if(!r.ok){if(r.status===409)setNeedsReload(true);throw new Error(data.error??"Could not calculate this review.");}
      setComputed(data.result);
    }catch(e){setError(e instanceof Error?e.message:"Could not calculate this review.");}
    finally{inFlight.current=false;setBusy(false);}
  }
  function reviewBody(action:string){return {action,versionId:selected!.versionId,weekStart:selected!.weekStart,requestKey:crypto.randomUUID(),
    evidenceToken:state!.evidence.evidence_token,openingCash:numberOrNull(opening),closingCash:numberOrNull(closing),activityConfirmed,allocations};}
  function addDecision(event:React.FormEvent){
    event.preventDefault();const plannedNeeded=decision.resolution!=="unplanned",actualNeeded=!["cancelled","missed"].includes(decision.resolution);
    const item=plannedNeeded&&decision.plannedItemId?decision.plannedItemId:null,actualId=actualNeeded&&decision.actualEventId?decision.actualEventId:null;
    if(!decision.rationale.trim() || (!item&&!actualId)){setError("Select the entries and explain the decision.");return;}
    if(item&&decision.plannedAmount.trim()==="" || actualId&&decision.actualAmount.trim()===""){setError("Enter the allocated amounts, including zero when confirmed.");return;}
    const a:StoredForecastAllocation={id:crypto.randomUUID(),resolution:decision.resolution,plannedItemId:item,actualEventId:actualId,
      plannedAmount:item?Number(decision.plannedAmount):0,actualAmount:actualId?Number(decision.actualAmount):0,
      method:"user_confirmed",confidence:"confirmed",rationale:decision.rationale.trim(),matchingPolicyVersion:MATCHING_POLICY};
    setAllocations(previous=>[...previous,a]);setDecision(blankDecision);setError(null);changed();
  }
  const locked=busy||!!pending||needsReload;
  const hasUnrecordedEntry=!!(actual.description.trim()||actual.amount.trim()||actual.correctionId);
  const e=state?.evidence,money=(value:number)=>reviewMoneyLabel(value,e?.reporting_currency??"USD");
  const visibleResult=computed??(!dirty&&!state?.latest?.evidenceChanged?state?.latest?.result:null);
  const plannedNeeded=decision.resolution!=="unplanned",actualNeeded=!["cancelled","missed"].includes(decision.resolution);

  return <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
    <Link href="/dashboard/cash-planning" className="text-sm text-teal underline">Back to cash planning</Link>
    <header className="mb-7 mt-4"><h1 className="text-2xl font-medium text-ink">Review a completed week</h1>
      <p className="mt-2 max-w-3xl text-sm text-dim">Compare the cash that moved with the plan you published. Explain differences, keep a weekly record and use what you learn to update your current plan.</p></header>
    {error&&<div role="alert" className="mb-5 rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-ink">{error}</div>}
    {notice&&<p role="status" className="mb-5 rounded-md border border-line bg-surface p-4 text-sm text-ink">{notice}</p>}
    {pending&&!busy&&<div className="mb-5 rounded-lg border border-line bg-surface p-5"><p className="text-sm text-ink">The save response was interrupted. Retry the same request to confirm whether it was saved. Your entries are held here until the result is known.</p>
      <button type="button" className={`${primary} mt-3`} onClick={()=>void sendWrite(pending)}>Retry the same save</button></div>}
    {queue.weeks.length===0?<section className="rounded-lg border border-line bg-surface p-6">
      <h2 className="text-lg font-medium text-ink">{queue.hasPublishedPlan?"Your first week is still in progress":"Publish a weekly cash plan first"}</h2>
      <p className="mt-2 text-sm text-dim">{queue.hasPublishedPlan?"A review becomes available after a full seven-day plan week has ended. Return then to record what happened.":"Weekly reviews compare actual cash with an earlier published plan. Create and publish your 13-week cash plan to start."}</p>
      {queue.hasPublishedPlan&&queue.firstReviewDate&&<p className="mt-3 text-sm text-ink">Your first completed week can be reviewed from {date(queue.firstReviewDate)}.</p>}
      <Link href="/dashboard/forecast" className="mt-4 inline-flex text-sm text-teal underline">Open weekly cash plan</Link>
    </section>:<>
      <section className="mb-5 rounded-lg border border-line bg-surface p-5"><label htmlFor="review-week" className="text-sm font-medium text-ink">1. Choose the week and published plan</label>
        <select id="review-week" className={`${field} mt-2`} disabled={busy||!!pending} value={selected?`${selected.versionId}:${selected.weekStart}`:""}
          onChange={event=>{const week=queue.weeks.find(w=>`${w.versionId}:${w.weekStart}`===event.target.value);if(week){setState(null);setNotice(null);void loadWeek(week);}}}>
          <option value="" disabled>Select a completed week</option>
          {queue.weeks.map(w=><option key={`${w.versionId}:${w.weekStart}`} value={`${w.versionId}:${w.weekStart}`}>{date(w.weekStart)} – {date(w.weekEnd)} · Plan {w.versionNumber} · {w.coverage==="complete"?"Reviewed":w.reviewId?"Partial review":"Not yet reviewed"}</option>)}
        </select><p className="mt-2 text-xs text-dim">Recent published plans are listed, including earlier versions. Match decisions apply to the selected plan and week. Changing weeks discards unsaved edits.</p>
        {selected&&<button type="button" disabled={busy||!!pending} className={`${secondary} mt-3`} onClick={()=>{setNotice(null);void loadWeek(selected);}}>Reload week and discard unsaved edits</button>}
      </section>
      {busy&&!state&&<p role="status" className="text-sm text-dim">Loading weekly evidence…</p>}
      {state&&e&&selected&&<div className="space-y-5" aria-busy={busy}>
        {state.latest?.evidenceChanged&&<p role="status" className="rounded-md border border-line bg-surface p-4 text-sm text-ink">Cash evidence changed after the last saved review. Check any earlier match decisions and calculate a new revision. The previous review remains in history.</p>}
        <section className="rounded-lg border border-line bg-surface p-5 sm:p-6"><h2 className="text-lg font-medium text-ink">2. Record the cash that actually moved</h2>
          <p className="mt-2 text-sm text-dim">Use bank statements or other records for {date(e.week_start)} – {date(e.week_end)}. Enter cash moving into or out of your available cash total. Exclude transfers between accounts already included in that total and unpaid invoices or bills. Blank balances mean unknown.</p>
          <fieldset disabled={locked} className="mt-4 grid gap-4 sm:grid-cols-2"><legend className="sr-only">Actual cash balances</legend>
            <label className="text-sm text-ink">Opening available cash ({e.reporting_currency})<input className={`${field} mt-1`} type="number" min="0" step="0.0001" value={opening} onChange={ev=>{setOpening(ev.target.value);changed();}}/></label>
            <label className="text-sm text-ink">Closing available cash ({e.reporting_currency})<input className={`${field} mt-1`} type="number" min="0" step="0.0001" value={closing} onChange={ev=>{setClosing(ev.target.value);changed();}}/></label>
          </fieldset>
          <label className="mt-4 flex items-start gap-3 text-sm text-ink"><input type="checkbox" className="mt-1 accent-teal" disabled={locked} checked={activityConfirmed} onChange={ev=>{setActivityConfirmed(ev.target.checked);changed();}}/>
            I checked all cash movements for this week against my records, including any week with no cash activity.</label>
          {e.actual_events.length===0?<p className="mt-5 text-sm text-dim">No actual cash entries recorded for this week. An empty list does not confirm that no cash moved.</p>:
            <ul className="mt-5 divide-y divide-line">{e.actual_events.map(entry=><li key={entry.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div><p className="text-ink">{entry.description}</p><p className="mt-1 text-xs text-dim">{date(entry.cash_date)} · {entry.direction==="inflow"?"Cash in":"Cash out"} · {money(entry.amount)} · {entry.source_type==="manual"?"Owner entered":"Source record"}</p></div>
              {entry.editable&&<button type="button" disabled={locked} className="text-xs text-teal underline disabled:opacity-50" onClick={()=>setActual({description:entry.description,amount:String(entry.amount),cashDate:entry.cash_date,direction:entry.direction,
                category:forecastCategoriesFor(entry.direction).find(c=>c.value===entry.category)?.value??(entry.direction==="inflow"?"other_cash_in":"other_cash_out"),note:"",correctionId:entry.id})}>Correct entry</button>}
            </li>)}</ul>}
          <details className="mt-5 rounded-md border border-line p-4" open={actual.correctionId?true:undefined}>
            <summary className="cursor-pointer text-sm font-medium text-teal">{actual.correctionId?"Correct a manual cash entry":"Add a manual cash entry"}</summary>
            <form className="mt-4" onSubmit={event=>{event.preventDefault();if(actual.amount.trim()===""){setError("Enter the amount, including zero when confirmed.");return;}
              void sendWrite({kind:"actual",body:{action:"record_actual",versionId:selected.versionId,weekStart:selected.weekStart,requestKey:crypto.randomUUID(),...actual,amount:Number(actual.amount)}});}}>
              <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Manual cash entry</legend>
                <label className="text-sm">Description<input required maxLength={500} className={`${field} mt-1`} value={actual.description} onChange={ev=>setActual({...actual,description:ev.target.value})}/></label>
                <label className="text-sm">Cash date<input required type="date" min={e.week_start} max={e.week_end} className={`${field} mt-1`} value={actual.cashDate} onChange={ev=>setActual({...actual,cashDate:ev.target.value})}/></label>
                <label className="text-sm">Direction<select className={`${field} mt-1`} value={actual.direction} onChange={ev=>setActual({...actual,direction:ev.target.value as ActualForm["direction"],category:ev.target.value==="inflow"?"other_cash_in":"other_cash_out"})}><option value="inflow">Cash in</option><option value="outflow">Cash out</option></select></label>
                <label className="text-sm">Cash category<select className={`${field} mt-1`} value={actual.category} onChange={ev=>setActual({...actual,category:ev.target.value as ForecastCategory})}>{forecastCategoriesFor(actual.direction).map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
                <label className="text-sm">Amount ({e.reporting_currency})<input required type="number" min="0" step="0.0001" className={`${field} mt-1`} value={actual.amount} onChange={ev=>setActual({...actual,amount:ev.target.value})}/></label>
                <label className="text-sm sm:col-span-2">{actual.correctionId?"Why are you correcting it?":"Evidence note (optional)"}<textarea required={!!actual.correctionId} maxLength={2000} className={`${field} mt-1`} value={actual.note} onChange={ev=>setActual({...actual,note:ev.target.value})}/></label>
                <div className="flex gap-3 sm:col-span-2"><button className={primary} type="submit">{actual.correctionId?"Save corrected entry":"Save cash entry"}</button>{hasUnrecordedEntry&&<button className={secondary} type="button" onClick={()=>setActual({description:"",amount:"",cashDate:e.week_start,direction:"inflow",category:"other_cash_in",note:"",correctionId:null})}>{actual.correctionId?"Cancel correction":"Clear entry"}</button>}</div>
              </fieldset><p className="mt-3 text-xs text-dim">Corrections preserve the earlier record. Recording an entry does not confirm that the week’s activity is complete.</p>
            </form>
          </details>
        </section>
        <section className="rounded-lg border border-line bg-surface p-5 sm:p-6"><h2 className="text-lg font-medium text-ink">3. Explain how the entries relate to the plan</h2>
          <p className="mt-2 text-sm text-dim">Only link entries when you have evidence. You can split a receipt or payment across several decisions. Keep uncertain entries marked Needs checking.</p>
          <div className="mt-4"><h3 className="text-sm font-medium text-ink">Planned cash this week</h3>
            {e.planned_items.length===0?<p className="mt-2 text-sm text-dim">No active cash items were planned for this week.</p>:<ul className="mt-2 divide-y divide-line">{e.planned_items.map(item=>{
              const allocated=allocations.filter(a=>a.plannedItemId===item.id).reduce((sum,a)=>sum+a.plannedAmount,0);
              return <li key={item.id} className="py-3 text-sm text-ink">{item.description}<p className="mt-1 text-xs text-dim">{date(item.expected_date)} · {item.direction==="inflow"?"Cash in":"Cash out"} · {money(item.amount)} planned · {money(Math.max(0,item.amount-allocated))} unallocated</p></li>;
            })}</ul>}
          </div>
          <form className="mt-5 rounded-md border border-line p-4" onSubmit={addDecision}><fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Add a match decision</legend>
            <label className="text-sm sm:col-span-2">What happened?<select className={`${field} mt-1`} value={decision.resolution} onChange={ev=>setDecision({...blankDecision,resolution:ev.target.value as DecisionForm["resolution"]})}>
              <option value="matched">Link actual cash to a planned item</option><option value="cancelled">Planned item was cancelled</option><option value="missed">Planned cash did not move this week</option><option value="unplanned">Actual cash was not in the plan</option><option value="unresolved">Needs checking</option>
            </select></label>
            {plannedNeeded&&<><label className="text-sm">Planned item<select required={decision.resolution!=="unresolved"} className={`${field} mt-1`} value={decision.plannedItemId} onChange={ev=>{const item=e.planned_items.find(i=>i.id===ev.target.value);const used=allocations.filter(a=>a.plannedItemId===item?.id).reduce((sum,a)=>sum+a.plannedAmount,0);setDecision({...decision,plannedItemId:ev.target.value,plannedAmount:item?String(Number(Math.max(0,item.amount-used).toFixed(4))):""});}}>
              <option value="">{decision.resolution==="unresolved"?"No planned item":"Choose planned item"}</option>{e.planned_items.map(i=><option key={i.id} value={i.id}>{i.description} · {money(i.amount)}</option>)}</select></label>
              <label className="text-sm">Planned amount covered<input required={!!decision.plannedItemId} type="number" min="0" step="0.0001" className={`${field} mt-1`} value={decision.plannedAmount} onChange={ev=>setDecision({...decision,plannedAmount:ev.target.value})}/></label></>}
            {actualNeeded&&<><label className="text-sm">Actual cash entry<select required={decision.resolution!=="unresolved"} className={`${field} mt-1`} value={decision.actualEventId} onChange={ev=>{const entry=e.actual_events.find(i=>i.id===ev.target.value);const used=allocations.filter(a=>a.actualEventId===entry?.id).reduce((sum,a)=>sum+a.actualAmount,0);setDecision({...decision,actualEventId:ev.target.value,actualAmount:entry?String(Number(Math.max(0,entry.amount-used).toFixed(4))):""});}}>
              <option value="">{decision.resolution==="unresolved"?"No actual entry":"Choose cash entry"}</option>{e.actual_events.map(i=><option key={i.id} value={i.id}>{i.description} · {i.direction==="inflow"?"in":"out"} · {money(i.amount)}</option>)}</select></label>
              <label className="text-sm">Actual amount covered<input required={!!decision.actualEventId} type="number" min="0" step="0.0001" className={`${field} mt-1`} value={decision.actualAmount} onChange={ev=>setDecision({...decision,actualAmount:ev.target.value})}/></label></>}
            <label className="text-sm sm:col-span-2">What supports this decision?<textarea required maxLength={2000} className={`${field} mt-1`} value={decision.rationale} onChange={ev=>setDecision({...decision,rationale:ev.target.value})}/></label>
            <div className="sm:col-span-2"><button className={secondary} type="submit">Add decision to review</button></div>
          </fieldset><p className="mt-3 text-xs text-dim">Links are confirmed by you. Similar amounts or descriptions alone do not establish a match. Payments in another week remain unresolved in this review.</p></form>
          <h3 className="mt-5 text-sm font-medium text-ink">Decisions in this review</h3>
          {allocations.length===0?<p className="mt-2 text-sm text-dim">No decisions added yet.</p>:<ul className="mt-2 divide-y divide-line">{allocations.map(a=><li key={a.id} className="flex items-start justify-between gap-4 py-3 text-sm">
            <div><p className="text-ink">{e.planned_items.find(i=>i.id===a.plannedItemId)?.description??(a.plannedItemId?"Earlier planned item":"Unplanned cash")} → {e.actual_events.find(i=>i.id===a.actualEventId)?.description??(a.actualEventId?"Earlier cash entry — check correction":a.resolution==="cancelled"?"Cancelled":a.resolution==="missed"?"Did not happen this week":"Needs checking")}</p>
              <p className="mt-1 text-xs text-dim">{money(a.plannedAmount)} planned / {money(a.actualAmount)} actual · {a.resolution==="unresolved"?"Needs checking":a.resolution==="matched"?"Linked by you":"Decision recorded"}</p><p className="mt-1 text-xs text-dim">{a.rationale}</p></div>
            <button type="button" disabled={locked} className="shrink-0 text-xs text-teal underline disabled:opacity-50" aria-label={`Remove decision: ${a.rationale}`} onClick={()=>{setAllocations(items=>items.filter(i=>i.id!==a.id));changed();}}>Remove</button>
          </li>)}</ul>}
        </section>
        <section className="rounded-lg border border-line bg-surface p-5 sm:p-6"><h2 className="text-lg font-medium text-ink">4. Review the result and save</h2>
          <p className="mt-2 text-sm text-dim">Calculate from the recorded evidence. Partial reviews are saved as partial; a later correction creates a new revision.</p>
          {hasUnrecordedEntry&&<p className="mt-3 text-sm text-dim">Save or clear the manual cash entry before calculating this review.</p>}
          <button className={`${secondary} my-4`} type="button" disabled={locked||hasUnrecordedEntry} onClick={()=>void calculate()}>Calculate this review</button>
          {visibleResult?<ReviewResult result={visibleResult} evidence={e}/>:<p className="text-sm text-dim">Calculate after adding or changing entries to see the current result.</p>}
          <div className="mt-5 flex flex-wrap items-center gap-4"><button className={primary} type="button" disabled={locked||hasUnrecordedEntry||!computed} onClick={()=>void sendWrite({kind:"save",body:reviewBody("save")})}>{computed?.coverage==="complete"?"Save weekly review":"Save partial review"}</button>
            {state.latest&&<span className="text-xs text-dim">Last saved: revision {state.latest.revision} · {new Date(state.latest.createdAt).toLocaleString("en-US")}</span>}</div>
          {state.latest&&<div className="mt-5 border-t border-line pt-5"><Link href={`/dashboard/forecast?review=${state.latest.id}`} className="text-sm font-medium text-teal underline">Update your current cash plan</Link>
            <p className="mt-2 text-xs text-dim">Confirm your current starting cash and future receipt and payment dates before publishing the next plan.{state.latest.result.coverage!=="complete"?" This review is partial; resolve missing evidence before relying on it.":""}</p>
            <details className="mt-4"><summary className="cursor-pointer text-sm text-teal">View saved review history</summary>
              <label className="mt-4 block text-sm">Saved revision<select className={`${field} mt-1`} disabled={locked} value={historyReview?.id??state.latest.id} onChange={ev=>void viewHistory(ev.target.value)}>
                {state.history.map(h=><option key={h.id} value={h.id}>Revision {h.revision} · {h.coverage==="complete"?"Reviewed":"Partial"} · {new Date(h.created_at).toLocaleString("en-US")}</option>)}
              </select></label><p className="mt-2 text-xs text-dim">The most recent 50 revisions are available here. Saved evidence remains unchanged; edits above start from the latest revision.</p>
              {historyReview&&<div className="mt-4"><ReviewResult result={historyReview.result} evidence={historyReview.evidence} policy={historyReview.policy}/></div>}
            </details>
          </div>}
        </section>
      </div>}
    </>}
  </div>;
}
