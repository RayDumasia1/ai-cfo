// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { cleanup,render,screen,waitFor,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ForecastCasesClient from "../app/dashboard/forecast-cases/ForecastCasesClient";
import { calculateForecastCase } from "../lib/forecastCases";
import { caseBase,caseIds,fixtureCasesView,savedCase } from "./fixtures/forecastCases";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
const fetcher=vi.fn();let state=structuredClone(fixtureCasesView);
beforeEach(()=>{
  state=structuredClone(fixtureCasesView);fetcher.mockReset();vi.stubGlobal("fetch",fetcher);
  fetcher.mockImplementation(async(_url:string,init?:RequestInit)=>{
    if(init?.method==="POST"){
      const b=JSON.parse(String(init.body)),calculation=calculateForecastCase(caseBase,b.assumptions,"2026-10-27");
      if(b.action==="save")state.cases=[{...structuredClone(savedCase),name:b.name,caseType:b.caseType,assumptions:b.assumptions,calculation}];
      return json({version_id:caseIds.saved,version_number:2,replayed:false,calculation});
    }
    return json(state);
  });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function build(){
  render(<ForecastCasesClient initialState={state}/>);const user=userEvent.setup();
  await user.type(screen.getByLabelText("Case name"),"Lower collections");
  await user.type(screen.getByLabelText("Assumption name"),"Partial receipt");
  await user.type(screen.getByLabelText(/Percentage of base amount/),"80");
  await user.click(within(screen.getByRole("group",{name:"Affected base-plan items"})).getByRole("checkbox",{name:/Customer receipt/}));
  await user.type(screen.getByLabelText("Why is this assumption reasonable?"),"Customer confirmed a partial settlement");
  await user.click(screen.getByRole("button",{name:"Add assumption"}));
  return user;
}
const posts=()=>fetcher.mock.calls.filter(([,init])=>init?.method==="POST").map(([,init])=>JSON.parse(String(init.body)));
describe("Saved cash-case owner workflow",()=>{
  it("keeps the empty state honest when no published base exists",()=>{
    render(<ForecastCasesClient initialState={{...state,base:null,currentBaseId:null,bases:[],baseResult:null}}/>);
    expect(screen.getByText("Publish a base cash plan first")).toBeTruthy();expect(fetcher).not.toHaveBeenCalled();
  });
  it("builds an explicit percentage assumption, compares exact weeks, saves and reloads history",async()=>{
    const user=await build();await user.click(screen.getByRole("button",{name:"Calculate case"}));
    await screen.findByRole("heading",{name:"Downside preview: Lower collections"});
    expect(posts()[0].assumptions[0]).toMatchObject({operation:"amount_multiplier",value:0.8,itemIds:[caseIds.receipt]});
    const table=screen.getByRole("table");expect(within(table).getAllByRole("row")).toHaveLength(14);
    await user.click(screen.getByRole("button",{name:"Save case version"}));await screen.findByText("Case saved as version 2.");
    expect(screen.getByText(/Lower collections · Downside · Version 2/)).toBeTruthy();
    expect(posts().filter(b=>b.action==="save")).toHaveLength(1);
  });
  it("holds the exact save request after a lost response and prevents editing until retry resolves",async()=>{
    const user=await build();await user.click(screen.getByRole("button",{name:"Calculate case"}));await screen.findByRole("heading",{name:"Downside preview: Lower collections"});
    fetcher.mockRejectedValueOnce(new Error("Connection interrupted"));
    await user.click(screen.getByRole("button",{name:"Save case version"}));const retry=await screen.findByRole("button",{name:"Retry the same save"});
    expect(screen.getByLabelText("Case name").matches(":disabled")).toBe(true);const first=posts().find(b=>b.action==="save");
    await user.click(retry);await screen.findByText("Case saved as version 2.");
    expect(posts().filter(b=>b.action==="save")[1]).toEqual(first);
  });
  it("keeps edits visible after a stale-base save and requires an explicit reload",async()=>{
    const user=await build();await user.click(screen.getByRole("button",{name:"Calculate case"}));await screen.findByRole("heading",{name:"Downside preview: Lower collections"});
    fetcher.mockResolvedValueOnce(json({error:"The base plan changed. Reload the cases."},409));
    await user.click(screen.getByRole("button",{name:"Save case version"}));await screen.findByRole("alert");
    expect((screen.getByLabelText("Case name") as HTMLInputElement).value).toBe("Lower collections");
    expect((screen.getByRole("button",{name:"Save case version"}) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button",{name:"Reload cases and discard unsaved edits"}));
    await waitFor(()=>expect((screen.getByLabelText("Case name") as HTMLInputElement).value).toBe(""));
  });
  it("opens saved assumptions without enabling an accidental duplicate save",async()=>{
    state.cases=[structuredClone(savedCase)];render(<ForecastCasesClient initialState={state}/>);const user=userEvent.setup();
    await user.click(screen.getByRole("button",{name:"View result and assumptions"}));
    expect((screen.getByLabelText("Case name") as HTMLInputElement).value).toBe("Delayed collections");
    expect(screen.getByText("Viewing saved version 2. Change assumptions and calculate to save another version.")).toBeTruthy();
    expect((screen.getByRole("button",{name:"Save case version"}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button",{name:"Remove assumption: Lower receipt"})).toBeTruthy();
  });
});
