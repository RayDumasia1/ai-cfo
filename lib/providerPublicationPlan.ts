import { PROVIDER_CASH_POLICY_VERSION,sameProviderScope,type NormalizedProviderMonth,type ProviderCashNormalization,type ProviderMonthProvenance } from "./providerCashNormalization";
import type { FinancialMonth } from "./types";

export type StoredProviderMonth={businessId:string|null;month:Partial<FinancialMonth>&Pick<FinancialMonth,"month_date"|"source_type">;provenance:ProviderMonthProvenance|null};
export type ProviderPublicationPlan={action:"blocked"|"new_month"|"unchanged"|"review_source_change"|"review_correction";
  reason:string;policyVersion:typeof PROVIDER_CASH_POLICY_VERSION;requiresAtomicRecheck:true};

/** A conflict plan, never a write authorization. No stored data is changed here. */
export function planProviderMonthPublication(normalized:ProviderCashNormalization,existing:StoredProviderMonth|null):ProviderPublicationPlan{
  const plan=(action:ProviderPublicationPlan["action"],reason:string):ProviderPublicationPlan=>({action,reason,policyVersion:PROVIDER_CASH_POLICY_VERSION,requiresAtomicRecheck:true});
  if(!normalized.valid||!normalized.month||!normalized.provenance)return plan("blocked","Complete and reconcile source evidence before preparing a publication.");
  if(!existing)return plan("new_month","No stored month overlaps this candidate. Recheck source identity, generation and ownership inside the future publication transaction.");
  const month=normalized.month,provenance=normalized.provenance;
  if(existing.month?.month_date!==month.month_date)return plan("blocked","The stored comparison period does not match the normalized month.");
  if(existing.businessId!==null&&existing.businessId!==provenance.scope.businessId)return plan("blocked","A stored month from another workspace cannot be used as an overlap candidate.");
  const prior=existing.provenance;
  if(existing.businessId===null||existing.month.source_type!=="quickbooks"||!prior?.scope
    ||prior.policyVersion!==PROVIDER_CASH_POLICY_VERSION||prior.monthDate!==month.month_date
    ||!sameProviderScope(prior.scope,provenance.scope)||prior.currencyPrecision!==provenance.currencyPrecision
    ||prior.cashPerimeterFingerprint!==provenance.cashPerimeterFingerprint||!Array.isArray(prior.cashAccountIds)
    ||JSON.stringify([...prior.cashAccountIds].sort())!==JSON.stringify(provenance.cashAccountIds)||!/^[a-f0-9]{64}$/.test(prior.evidenceFingerprint))
    return plan("review_source_change","Replacing spreadsheet/manual history or changing company, connection, generation, cash perimeter or policy requires an explicit source review. Do not blend the two sources.");
  const sameValues=Object.keys(month).filter(key=>key!=="notes").every(key=>month[key as keyof NormalizedProviderMonth]===existing.month[key as keyof NormalizedProviderMonth]);
  if(sameValues&&prior.evidenceFingerprint===provenance.evidenceFingerprint)
    return plan("unchanged","The normalized values and evidence are unchanged. Preserve financial data, notes and its data version; record sync receipt status separately.");
  return plan("review_correction","Source evidence or normalized financial values changed. Review the correction and retain the prior revision before publication.");
}
