import type { CashBridgeField,ProviderCashBatch,ProviderCashBinding,ProviderCashMovement,ProviderScope } from "../../lib/providerCashNormalization";
export function providerCashFixture(){
  const scope:ProviderScope={businessId:"workspace-a",connectionId:"connection-a",companyId:"realm-a",generation:"generation-1",reportingCurrency:"USD"};
  const binding:ProviderCashBinding={...scope,provider:"quickbooks",status:"connected",currencyPrecision:2,cashAccountIds:["bank-a","bank-b"],cashPerimeterConfirmed:true};
  const event=(id:string,amount:string,fromAccountId:string|null,toAccountId:string|null,classification:CashBridgeField|null,kind:ProviderCashMovement["kind"]="cash_movement"):ProviderCashMovement=>({
    sourceEventId:id,sourceRevision:"1",kind,status:"posted",cashDate:"2026-09-15",amount,reportingCurrency:"USD",fromAccountId,toAccountId,classification});
  const movements=[event("Payment:customer:1","200.00",null,"bank-a","cash_collected_from_customers"),
    event("Purchase:vendor:1","100.00","bank-a",null,"operating_cash_paid"),event("Payment:payroll:1","75.00","bank-b",null,"operating_cash_paid"),
    event("Transfer:internal:1","150.00","bank-a","bank-b",null,"transfer"),event("Deposit:funding:1","500.00",null,"bank-a","debt_funding_received"),
    event("Payment:owner:1","50.00","bank-b",null,"owner_draws_paid"),event("Payment:principal:1","100.00","bank-a",null,"debt_principal_paid"),
    event("Payment:interest:1","25.00","bank-a",null,"debt_interest_paid"),event("Purchase:asset:1","200.00","bank-a",null,"investing_cash_paid"),
    event("Deposit:asset:1","80.00",null,"bank-b","investing_cash_received"),event("Deposit:equity:1","60.00",null,"bank-b","owner_funding_received"),
    event("Deposit:other:1","10.00",null,"bank-a","other_cash_inflows"),event("Payment:other:1","5.00","bank-b",null,"other_cash_outflows"),
    event("Invoice:unpaid:1","9000.00",null,null,null,"non_cash_document"),event("Transfer:outside:1","300.00","excluded-a","excluded-b",null,"transfer")];
  const batch:ProviderCashBatch={scope:{...scope},sourceBasis:"direct_cash_ledger",batchId:"batch-1",monthDate:"2026-09-01",windowStart:"2026-09-01",windowEnd:"2026-09-30",
    retrievedAt:"2026-10-28T12:00:00Z",retrievalStatus:"complete",paginationComplete:true,periodCoverageConfirmed:true,
    accounts:[{accountId:"bank-a",reportingCurrency:"USD",openingDate:"2026-09-01",closingDate:"2026-09-30",openingBalance:"1000.00",closingBalance:"1135.00"},
      {accountId:"bank-b",reportingCurrency:"USD",openingDate:"2026-09-01",closingDate:"2026-09-30",openingBalance:"500.00",closingBalance:"660.00"}],movements,closingUnavailableCash:"100.00",unavailableCashConfirmed:true};
  return {binding,batch,scope:{...scope},evaluation:{date:"2026-10-28",timestamp:"2026-10-28T12:10:00Z"}};
}
export function zeroProviderCashFixture(){
  const f=providerCashFixture();f.binding.cashAccountIds=["bank-a"];f.batch.accounts=[{...f.batch.accounts[0],openingBalance:"0.00",closingBalance:"0.00"}];
  f.batch.movements=[];f.batch.closingUnavailableCash="0.00";return f;
}
