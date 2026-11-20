import json

with open('/home/mhdi/Project/open-learn/blackfriday/enterprise_54_node_workflow_fixed.json') as f:
    wf = json.load(f)

for node in wf['nodes']:
    if node['name'] == 'R4. 6-Hour Deduplication Memory':
        node['parameters']['jsCode'] = """const DEDUPE_HOURS = 6;
let isManualTest = false;
try {
  isManualTest = ($execution.mode === 'manual') || Boolean($input.first()?.json?.reset_dedupe) || Boolean($input.first()?.json?.force_alert);
} catch(e) {}

const store = $getWorkflowStaticData('global');
store.alerted = store.alerted || {};

if ($input.first()?.json?.reset_dedupe === true) {
  store.alerted = {};
}

const now = Date.now();
for (const k of Object.keys(store.alerted)) {
  if (now - store.alerted[k] > DEDUPE_HOURS * 3600 * 1000) delete store.alerted[k];
}

const out = [];
for (const item of items) {
  const d = item.json;
  if (d.deal_grade === 'DROP') {
    out.push({ json: { ...d, is_new_alert: false } });
    continue;
  }
  const key = `${d.sku_id || d.tracking_id}|${d.total_cost_toman}|${d.deal_grade}`;
  const isNew = isManualTest || !store.alerted[key];
  if (!isManualTest && isNew) {
    store.alerted[key] = now;
  }
  out.push({ json: { ...d, is_new_alert: isNew, dedupe_key: key } });
}
return out;"""

with open('/home/mhdi/Project/open-learn/blackfriday/enterprise_54_node_workflow_fixed.json', 'w') as f:
    json.dump(wf, f, indent=2)

with open('/home/mhdi/Project/open-learn/blackfriday/enterprise_54_node_workflow.json', 'w') as f:
    json.dump(wf, f, indent=2)

print('Updated R4 node successfully in update_r4.py!')

