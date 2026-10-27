// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ForecastReviewClient from "../app/dashboard/forecast-review/ForecastReviewClient";
import { ownerReviewState, reviewFixtureResult, reviewIds, reviewWeek, savedReviewState } from "./fixtures/forecastReview";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
let state=structuredClone(ownerReviewState);
const fetcher=vi.fn();
beforeEach(()=>{
  state=structuredClone(ownerReviewState);vi.stubGlobal("fetch",fetcher);fetcher.mockReset();
  fetcher.mockImplementation(async(_url:string,init?:RequestInit)=>{
    if(init?.method==="POST"){
      const body=JSON.parse(String(init.body));
      if(body.action==="calculate")return json({result:reviewFixtureResult});
      if(body.action==="save"){state=structuredClone(savedReviewState);return json({review_id:reviewIds.review,revision:1,result:reviewFixtureResult});}
      return json({event_id:reviewIds.actual,revision:1});
    }
    return String(_url).includes("versionId=")?json(state):json({weeks:[reviewWeek],hasPublishedPlan:true});
  });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function open(){
  render(<ForecastReviewClient initialQueue={{weeks:[reviewWeek],hasPublishedPlan:true}}/>);
  await screen.findByRole("heading",{name:"2. Record the cash that actually moved"});
  await waitFor(()=>expect((screen.getByRole("button",{name:"Calculate this review"}) as HTMLButtonElement).disabled).toBe(false));
  return userEvent.setup();
}
const posts=()=>fetcher.mock.calls.filter(([,init])=>init?.method==="POST").map(([,init])=>JSON.parse(String(init.body)));
describe("Owner weekly review workflow",()=>{
  it("explains the empty states without inventing a reviewable week",()=>{
    const view=render(<ForecastReviewClient initialQueue={{weeks:[],hasPublishedPlan:false}}/>);
    expect(screen.getByText("Publish a weekly cash plan first")).toBeTruthy();expect(fetcher).not.toHaveBeenCalled();
    view.rerender(<ForecastReviewClient initialQueue={{weeks:[],hasPublishedPlan:true}}/>);
    // Queue is initialized on mount, as with a server navigation.
    view.unmount();render(<ForecastReviewClient initialQueue={{weeks:[],hasPublishedPlan:true}}/>);
    expect(screen.getByText("Your first week is still in progress")).toBeTruthy();
  });
  it("records an explicit match, calculates, saves and offers the plan-update handoff",async()=>{
    const user=await open();
    await user.type(screen.getByLabelText("Opening available cash (USD)"),"5000");
    await user.type(screen.getByLabelText("Closing available cash (USD)"),"5900");
    await user.click(screen.getByRole("checkbox"));
    await user.selectOptions(screen.getByLabelText("Planned item"),reviewIds.planned);
    await user.selectOptions(screen.getByLabelText("Actual cash entry"),reviewIds.actual);
    await user.type(screen.getByLabelText("What supports this decision?"),"Bank receipt confirms the invoice");
    await user.click(screen.getByRole("button",{name:"Add decision to review"}));
    await user.click(screen.getByRole("button",{name:"Calculate this review"}));
    await screen.findByRole("heading",{name:"This week’s cash is reconciled"});
    const calculation=posts().find(b=>b.action==="calculate");
    expect(calculation).toMatchObject({openingCash:5000,closingCash:5900,activityConfirmed:true,
      allocations:[{plannedItemId:reviewIds.planned,actualEventId:reviewIds.actual,plannedAmount:1000,actualAmount:900}]});
    await user.click(screen.getByRole("button",{name:"Save weekly review"}));
    await screen.findByText("Review saved as revision 1.");
    expect(screen.getByRole("link",{name:"Update your current cash plan"}).getAttribute("href")).toBe(`/dashboard/forecast?review=${reviewIds.review}`);
    expect(posts().filter(b=>b.action==="save")).toHaveLength(1);
  });
  it("keeps a lost-response save payload intact and locks edits until the retry resolves",async()=>{
    state=structuredClone(savedReviewState);
    const user=await open();
    await user.click(screen.getByRole("button",{name:"Calculate this review"}));
    await screen.findByRole("button",{name:"Save weekly review"});
    let lost=true;
    fetcher.mockImplementation(async(_url:string,init?:RequestInit)=>{
      if(init?.method==="POST"){
        if(lost){lost=false;throw new Error("Network response interrupted");}
        state=structuredClone(savedReviewState);return json({review_id:reviewIds.review,revision:1,result:reviewFixtureResult});
      }
      return String(_url).includes("versionId=")?json(state):json({weeks:[reviewWeek],hasPublishedPlan:true});
    });
    await user.click(screen.getByRole("button",{name:"Save weekly review"}));
    const retry=await screen.findByRole("button",{name:"Retry the same save"});
    expect(screen.getByLabelText("Opening available cash (USD)").matches(":disabled")).toBe(true);
    const original=posts().find(b=>b.action==="save");
    await user.click(retry);await screen.findByText("Review saved as revision 1.");
    const saves=posts().filter(b=>b.action==="save");expect(saves).toHaveLength(2);expect(saves[1]).toEqual(original);
  });
  it("requires reload after a stale calculation and does not silently discard the edit",async()=>{
    const user=await open();await user.type(screen.getByLabelText("Opening available cash (USD)"),"123");
    fetcher.mockImplementationOnce(async()=>json({error:"This week’s evidence changed. Reload the week."},409));
    await user.click(screen.getByRole("button",{name:"Calculate this review"}));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Opening available cash (USD)") as HTMLInputElement).value).toBe("123");
    expect((screen.getByRole("button",{name:"Calculate this review"}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button",{name:"Reload week and discard unsaved edits"}));
    await waitFor(()=>expect((screen.getByLabelText("Opening available cash (USD)") as HTMLInputElement).value).toBe(""));
  });
  it("preserves unsaved matching decisions when a cash entry is recorded and resets activity confirmation",async()=>{
    const user=await open();await user.click(screen.getByRole("checkbox"));
    await user.selectOptions(screen.getByLabelText("Planned item"),reviewIds.planned);
    await user.selectOptions(screen.getByLabelText("Actual cash entry"),reviewIds.actual);
    await user.type(screen.getByLabelText("What supports this decision?"),"Confirmed deposit");
    await user.click(screen.getByRole("button",{name:"Add decision to review"}));
    await user.click(screen.getByText("Add a manual cash entry"));
    await user.type(screen.getByLabelText("Description"),"Cash receipt");await user.type(screen.getByLabelText("Amount (USD)"),"0");
    expect((screen.getByRole("button",{name:"Calculate this review"}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button",{name:"Save cash entry"}));
    await waitFor(()=>expect((screen.getByLabelText("Description") as HTMLInputElement).value).toBe(""));
    expect(screen.getByRole("button",{name:"Remove decision: Confirmed deposit"})).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(posts().find(b=>b.action==="record_actual")).toMatchObject({amount:0,correctionId:null});
  });
  it("shows saved history using the original evidence after a source correction",async()=>{
    state=structuredClone(savedReviewState);state.latest!.evidenceChanged=true;
    state.latest!.result.variances[0].plannedItemId=null;
    state.evidence.actual_events[0].description="Corrected new description";
    const user=await open();
    expect(screen.getByText(/Cash evidence changed after the last saved review/)).toBeTruthy();
    await user.click(screen.getByText("View saved review history"));
    const details=screen.getByText("View saved review history").closest("details")!;
    expect(within(details).getByRole("rowheader",{name:/Customer deposit/})).toBeTruthy();
    expect(within(details).getByLabelText("Saved revision")).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
});
