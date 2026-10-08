import json
import collections

REGISTRY_PATH = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\02-模板库\templates-registry.json"

with open(REGISTRY_PATH, 'r', encoding='utf-8') as f:
    data = json.load(f)

templates = data.get('templates', [])

pan_list = []
precise_list = []
unassigned_list = []

for t in templates:
    tid = t.get('templateId')
    name = t.get('name', '')
    cat = t.get('category', '')
    tags = t.get('tags', {})
    traffic_tag = tags.get('traffic', '未标注')
    
    info = {
        'id': tid,
        'name': name,
        'category': cat,
        'traffic_tag': traffic_tag,
        'audience': tags.get('audience', '未标注'),
        'business': tags.get('business', '未标注'),
        'desc': t.get('description', '')
    }
    
    if '泛流' in name or '泛流' in cat or traffic_tag == '泛流量':
        pan_list.append(info)
    elif '精准' in name or '精准' in cat or traffic_tag == '精准流量':
        precise_list.append(info)
    else:
        unassigned_list.append(info)

out_text = []
out_text.append(f"==================================================")
out_text.append(f"📊 现有模板库全景审计报告 (总计 {len(templates)} 套)")
out_text.append(f"==================================================")
out_text.append(f"1. 泛流量模板: {len(pan_list)} 套 ({len(pan_list)/len(templates)*100:.1f}%)")
out_text.append(f"2. 精准流量模板: {len(precise_list)} 套 ({len(precise_list)/len(templates)*100:.1f}%)")
out_text.append(f"3. 无法自动判定: {len(unassigned_list)} 套 ({len(unassigned_list)/len(templates)*100:.1f}%)")

out_text.append(f"\n--- 【泛流量模板全量清单 ({len(pan_list)} 套)】 ---")
for x in pan_list:
    out_text.append(f"[{x['id']}] traffic={x['traffic_tag']} | aud={x['audience']} | biz={x['business']}")
    out_text.append(f"   名称: {x['name']}")

out_text.append(f"\n--- 【精准流量模板样例 (前 15 套)】 ---")
for x in precise_list[:15]:
    out_text.append(f"[{x['id']}] traffic={x['traffic_tag']} | aud={x['audience']} | biz={x['business']}")
    out_text.append(f"   名称: {x['name']}")

if unassigned_list:
    out_text.append(f"\n--- 【待确认/未分类清单 ({len(unassigned_list)} 套)】 ---")
    for x in unassigned_list:
        out_text.append(f"[{x['id']}] traffic={x['traffic_tag']} | 名称: {x['name']}")

with open('d:/AICode/工具开发/projects/content-production-app/tests/migration_output/template_audit_report.txt', 'w', encoding='utf-8') as f:
    f.write("\n".join(out_text))

print("AUDIT_DONE")
