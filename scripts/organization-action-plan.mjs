// D4A: read-only evidence, never a repair or authorization decision.
export const actionOwnershipEvidenceSql = `
WITH owners AS (
  SELECT p.user_id,p.id AS profile_id,l.organization_id,s.organization_id AS scope_id,
    (SELECT count(*) FROM public.legacy_account_organizations history WHERE history.legacy_user_id=p.user_id) AS historical_scope_count
  FROM public.business_profiles p
  LEFT JOIN public.legacy_account_organizations l ON l.current_business_profile_id=p.id
    AND l.legacy_user_id=p.user_id AND l.state='live'
  LEFT JOIN organization_private.financial_scopes s ON s.organization_id=l.organization_id
    AND s.legacy_business_profile_id=p.id AND s.legacy_user_id=p.user_id
), action_scope AS (
  SELECT a.*,o.profile_id,o.organization_id,o.scope_id,o.historical_scope_count,v.id AS version_id,v.user_id AS version_user,
    f.id AS forecast_id,f.user_id AS forecast_user,f.business_id AS forecast_business,
    i.id AS item_id,i.user_id AS item_user,i.version_id AS item_version
  FROM public.actions a LEFT JOIN owners o ON o.user_id=a.user_id
  LEFT JOIN public.cash_forecast_versions v ON v.id=a.linked_forecast_version_id
  LEFT JOIN public.cash_forecasts f ON f.id=v.forecast_id
  LEFT JOIN public.cash_forecast_items i ON i.id=a.linked_forecast_item_id
)
SELECT jsonb_build_object(
  'actions',(SELECT jsonb_build_object(
    'rows',count(*),'null_business',count(*) FILTER(WHERE business_id IS NULL),
    'missing_owner_scope',count(*) FILTER(WHERE user_id IS NULL OR profile_id IS NULL OR organization_id IS NULL OR scope_id IS NULL),
    'ambiguous_history',count(*) FILTER(WHERE business_id IS NULL AND historical_scope_count>1),
    'conflicting_business',count(*) FILTER(WHERE business_id IS NOT NULL AND business_id IS DISTINCT FROM profile_id),
    'invalid_status',count(*) FILTER(WHERE status IS NULL OR status NOT IN ('not_started','in_progress','completed')),
    'foreign_forecast',count(*) FILTER(WHERE linked_forecast_version_id IS NOT NULL AND
      (version_id IS NULL OR version_user IS DISTINCT FROM user_id OR forecast_id IS NULL OR forecast_user IS DISTINCT FROM user_id OR forecast_business IS DISTINCT FROM profile_id)),
    'foreign_item',count(*) FILTER(WHERE linked_forecast_item_id IS NOT NULL AND
      (linked_forecast_version_id IS NULL OR item_id IS NULL OR item_user IS DISTINCT FROM user_id OR item_version IS DISTINCT FROM linked_forecast_version_id))
    ) FROM action_scope),
  'audit',(SELECT jsonb_build_object('rows',count(*),
    'missing_or_foreign_action',count(*) FILTER(WHERE a.id IS NULL OR a.user_id IS DISTINCT FROM h.user_id),
    'missing_owner_scope',count(*) FILTER(WHERE o.scope_id IS NULL))
    FROM public.action_audit_log h LEFT JOIN public.actions a ON a.id=h.action_id LEFT JOIN owners o ON o.user_id=h.user_id),
  'usage',(SELECT jsonb_build_object('rows',count(*),
    'missing_owner_scope',count(*) FILTER(WHERE o.scope_id IS NULL),
    'ambiguous_history',count(*) FILTER(WHERE o.historical_scope_count>1),
    'invalid_count',count(*) FILTER(WHERE u.count IS NULL OR u.count<0),
    'invalid_limit',count(*) FILTER(WHERE u.usage_limit<0),
    'invalid_period',count(*) FILTER(WHERE u.period_start IS NULL OR u.period_end IS NULL OR u.period_end<=u.period_start),
    'unknown_metric',count(*) FILTER(WHERE u.metric IS NULL OR u.metric NOT IN ('ask_cfo_questions','ai_insight_runs','actions_created')))
    FROM public.usage_tracking u LEFT JOIN owners o ON o.user_id=u.user_id),
  'duplicate_usage_keys',(SELECT count(*) FROM (SELECT user_id,metric,period_start FROM public.usage_tracking GROUP BY user_id,metric,period_start HAVING count(*)>1) duplicates)
) AS evidence`;

const required = {
  actions:['rows','null_business','missing_owner_scope','ambiguous_history','conflicting_business','invalid_status','foreign_forecast','foreign_item'],
  audit:['rows','missing_or_foreign_action','missing_owner_scope'],
  usage:['rows','missing_owner_scope','ambiguous_history','invalid_count','invalid_limit','invalid_period','unknown_metric'],
};
export function actionOwnershipPlan(evidence) {
  const blockers=[];
  if(!evidence || typeof evidence!=='object')throw new Error('Ownership evidence required');
  for(const [domain,fields] of Object.entries(required)){
    for(const field of fields){
      const count=evidence[domain]?.[field];
      if(!Number.isSafeInteger(count)||count<0)throw new Error('Malformed aggregate evidence');
      if(field!=='rows'&&count>evidence[domain].rows)throw new Error('Inconsistent aggregate evidence');
      if(field!=='rows'&&field!=='null_business'&&count>0)blockers.push({domain,reason:field,rows:count});
    }
  }
  if(!Number.isSafeInteger(evidence.duplicate_usage_keys)||evidence.duplicate_usage_keys<0)throw new Error('Malformed duplicate count');
  if(evidence.duplicate_usage_keys)blockers.push({domain:'usage',reason:'duplicate_usage_keys',rows:evidence.duplicate_usage_keys});
  return {
    format:'org-action-plan-1',status:blockers.length?'BLOCKED':'READY_FOR_STORAGE_DESIGN',
    counts:{actions:evidence.actions.rows,audit:evidence.audit.rows,usage:evidence.usage.rows},
    proposed_null_business_repairs:blockers.length?0:evidence.actions.null_business,
    blockers,storage_migration_applied:false,authority_converted:false,
    note:'Point-in-time read-only evidence. Recheck and preserve exact rows under migration locks; this plan executes no repair.',
  };
}
