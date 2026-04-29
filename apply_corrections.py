#!/usr/bin/env python3
"""
Apply BFS analysis corrections to family_data.js
Based on review files R1, R2, R3 and confirmed hierarchy.
"""

import json
import re
from collections import defaultdict

# ---- Load data ----
with open('/Users/rjioussy/work/projects/familytree/family_data.js', 'r', encoding='utf-8') as f:
    raw = f.read()

json_str = raw.strip()
if json_str.startswith('const familyData = '):
    json_str = json_str[len('const familyData = '):]
if json_str.endswith(';'):
    json_str = json_str[:-1]

data = json.loads(json_str)
people = data['people']
partnerships = data['partnerships']

# ---- Build lookup structures ----
person_to_pp_as_parent = defaultdict(list)
child_to_partnership = {}

for pp in partnerships:
    for partner in pp['partners']:
        if partner is not None:
            person_to_pp_as_parent[partner].append(pp)
    for child in pp['children']:
        child_to_partnership[child] = pp

pp_by_id = {pp['id']: pp for pp in partnerships}

def describe_person(pid):
    if pid is None: return 'None'
    p = people[pid]
    return f"{pid}:{p['name']}(gen={p['generation']})"

# Track all corrections applied
corrections_log = []

def move_child(child_id, from_pp_id, to_pp_id, reason):
    """Remove child_id from from_pp_id children and add to to_pp_id children."""
    from_pp = pp_by_id[from_pp_id]
    to_pp = pp_by_id[to_pp_id]

    child_name = people[child_id]['name']
    old_parent_id = from_pp['partners'][0]
    new_parent_id = to_pp['partners'][0]
    old_parent_name = people[old_parent_id]['name'] if old_parent_id else '?'
    new_parent_name = people[new_parent_id]['name'] if new_parent_id else '?'

    if child_id not in from_pp['children']:
        print(f"WARNING: {child_id} not in {from_pp_id} children! Skipping remove.")
        return False

    if child_id in to_pp['children']:
        print(f"INFO: {child_id} already in {to_pp_id} children. Skipping add.")
        return False

    from_pp['children'].remove(child_id)
    to_pp['children'].append(child_id)

    # Update child_to_partnership
    child_to_partnership[child_id] = to_pp

    log_entry = {
        'action': 'move_child',
        'child_id': child_id,
        'child_name': child_name,
        'from_pp': from_pp_id,
        'from_parent': f"{old_parent_id}:{old_parent_name}",
        'to_pp': to_pp_id,
        'to_parent': f"{new_parent_id}:{new_parent_name}",
        'reason': reason
    }
    corrections_log.append(log_entry)
    print(f"MOVED: {child_name}({child_id}) from {old_parent_name} to {new_parent_name} [{reason}]")
    return True


def add_new_partnership(parent_id, child_ids):
    """Create a new partnership for parent_id with child_ids."""
    new_pp_id = f"pp{len(partnerships) + 1}"
    # Ensure uniqueness
    existing_ids = {pp['id'] for pp in partnerships}
    counter = len(partnerships) + 1
    while new_pp_id in existing_ids:
        counter += 1
        new_pp_id = f"pp{counter}"

    new_pp = {
        'id': new_pp_id,
        'partners': [parent_id, None],
        'children': list(child_ids)
    }
    partnerships.append(new_pp)
    pp_by_id[new_pp_id] = new_pp
    person_to_pp_as_parent[parent_id].append(new_pp)
    for child in child_ids:
        child_to_partnership[child] = new_pp

    parent_name = people[parent_id]['name']
    child_names = [people[c]['name'] for c in child_ids]
    print(f"CREATED: Partnership {new_pp_id} for {parent_name}({parent_id}) with children {child_names}")
    return new_pp_id


print("=" * 70)
print("APPLYING CORRECTIONS TO family_data.js")
print("=" * 70)

# =============================================================================
# SECTION 1: R1 CORRECTIONS - واكد@18,106 early tree fixes
# =============================================================================
print("\n--- R1: واكد@18,106 early tree corrections ---")

# R1 confirmed: واكد(p15) -> [عبدالغني(p24), عبدالله(p25), مصطفى_SPINE(p126)]
# Current: pp15 has [p24, p25], pp60 (سعيد's) has [p126, p127, p128]

# 1a. MOVE p126(مصطفى@27,106) from pp60 (سعيد p81) to pp15 (واكد p15)
move_child('p126', 'pp60', 'pp15',
           'مصطفى@27,106 is direct child of واكد@18,106, not of سعيد@25,108 (R1 canonical)')

# 1b. MOVE p129(صايل@27,112) from pp61 (عبدالكريم p82) to pp60 (سعيد p81)
# R1 says سعيد@25,108 -> [واكد@27,108, محمد@27,110, صايل@27,112]
# Current pp60 (سعيد) has [p127(واكد@27), p128(محمد@27)] after removing p126
move_child('p129', 'pp61', 'pp60',
           'صايل@27,112 is child of سعيد@25,108 not of عبدالكريم@25,113 (R1 canonical)')

# 1c. R1 says محمد@27,110 (p128) -> [عبدالفتاح@29,114 (p198), حازم@29,115 (p199)]
# Current: p198(عبدالفتاح) is under p129(صايل) in pp95
#          p199(حازم) is under p130(صابر) in some pp
# Find p198's current pp:
pp_for_p198 = child_to_partnership.get('p198')
pp_for_p199 = child_to_partnership.get('p199')

print(f"p198(عبدالفتاح) currently in {pp_for_p198['id'] if pp_for_p198 else 'NONE'}")
print(f"p199(حازم) currently in {pp_for_p199['id'] if pp_for_p199 else 'NONE'}")

# p128(محمد@27) has no partnership as parent currently - create one
p128_partnerships = person_to_pp_as_parent['p128']
if not p128_partnerships:
    new_pp_id = add_new_partnership('p128', ['p198', 'p199'])
    # Remove from old partnerships
    if pp_for_p198:
        if 'p198' in pp_for_p198['children']:
            pp_for_p198['children'].remove('p198')
            corrections_log.append({
                'action': 'remove_child',
                'child_id': 'p198',
                'child_name': 'عبدالفتاح',
                'from_pp': pp_for_p198['id'],
                'reason': 'عبدالفتاح@29,114 belongs to محمد@27,110 not صايل@27,112 (R1)'
            })
            print(f"REMOVED: عبدالفتاح(p198) from {pp_for_p198['id']}")
    if pp_for_p199:
        if 'p199' in pp_for_p199['children']:
            pp_for_p199['children'].remove('p199')
            corrections_log.append({
                'action': 'remove_child',
                'child_id': 'p199',
                'child_name': 'حازم',
                'from_pp': pp_for_p199['id'],
                'reason': 'حازم@29,115 belongs to محمد@27,110 not صابر@27,116 (R1)'
            })
            print(f"REMOVED: حازم(p199) from {pp_for_p199['id']}")
else:
    print(f"p128(محمد@27) already has partnership: {p128_partnerships[0]['id']}")

# 1d. R1 says صابر@27,116 -> [ظافر@29,116, زاهر@29,117, مهند@29,118]
# Current: pp for صابر (p130) = let's find it
pp_for_p130 = None
for pp in person_to_pp_as_parent['p130']:
    pp_for_p130 = pp
    break
print(f"\np130(صابر) partnership: {pp_for_p130['id'] if pp_for_p130 else 'NONE'}")
print(f"Current children: {[(c, people[c]['name']) for c in pp_for_p130['children']] if pp_for_p130 else 'NONE'}")

# p130(صابر) currently has [p200(ظافر), p201(زاهر)] after حازم was removed
# Need to ADD p202(مهند) to صابر's children
# p202(مهند) is currently under p131(سمير)
pp_for_p202 = child_to_partnership.get('p202')
if pp_for_p202 and pp_for_p130:
    move_child('p202', pp_for_p202['id'], pp_for_p130['id'],
               'مهند@29,118 is child of صابر@27,116 not of سمير@27,119 (R1 canonical)')

# 1e. R1 says سمير@27,119 -> [فراس@29,119, بشار@29,120] only
# Current: p131(سمير) has [p203(فراس), p204(بشار)] after مهند removed - CORRECT!

# 1f. ADD p257(زهير@37,110) as child of p243(عبدالرحمن@32,106)
# p257 currently under p249(نمر) in some pp
pp_for_p257 = child_to_partnership.get('p257')
# p243 has pp122 as its partnership
pp122 = pp_by_id.get('pp122')
if pp_for_p257 and pp122:
    move_child('p257', pp_for_p257['id'], 'pp122',
               'زهير@37,110 is direct child of عبدالرحمن@32,106 not of نمر@35,124 (R3/S3 canonical)')

print("\n--- R3: Col-106 spine chain corrections ---")

# =============================================================================
# SECTION 2: R3 CORRECTIONS - Col-106 spine linear chain
# =============================================================================
# The spine chain: p15 -> p126 -> p243 -> p349 -> p433 -> p570 -> p583 -> p611 -> p705
# Current wrong parents:
# p126 -> pp60 (p81 سعيد) -- ALREADY FIXED ABOVE
# p243 -> pp121 (p230 خالد)
# p349 -> pp161 (p340 قيس)
# p433 -> pp178 (p417 عبدالغني)
# p570 -> pp233 (p569 احمد)
# p583 -> pp237 (p582 عبدالرؤف)
# p611 -> pp247 (p609 ماجد)
# p705 -> pp290 (p703 صهيب)
#
# Target partnerships (parents' existing pp as parent):
# p126's pp as parent: pp93 -> ADD p243
# p243's pp as parent: pp122 -> ADD p349
# p349's pp as parent: pp162 -> ADD p433
# p433's pp as parent: pp179 -> ADD p570
# p570's pp as parent: pp234 -> ADD p583
# p583's pp as parent: pp238 -> ADD p611
# p611's pp as parent: pp249 -> ADD p705

spine_chain = [
    # (child_id, from_pp_id, to_pp_id, correct_parent_name, spine_row_info)
    ('p243', 'pp121', 'pp93',   'مصطفى@27,106',   'عبدالرحمن@32,106 should be child of مصطفى@27,106 (R3)'),
    ('p349', 'pp161', 'pp122',  'عبدالرحمن@32,106', 'محمود@42,106 should be child of عبدالرحمن@32,106 (R3)'),
    ('p433', 'pp178', 'pp162',  'محمود@42,106',    'ابراهيم@52,106 should be child of محمود@42,106 (R3)'),
    ('p570', 'pp233', 'pp179',  'ابراهيم@52,106',   'عبدالفتاح@64,106 should be child of ابراهيم@52,106 (R3)'),
    ('p583', 'pp237', 'pp234',  'عبدالفتاح@64,106', 'عثمان@69,106 should be child of عبدالفتاح@64,106 (R3)'),
    ('p611', 'pp247', 'pp238',  'عثمان@69,106',    'عبدالرحيم@77,106 should be child of عثمان@69,106 (R3)'),
    ('p705', 'pp290', 'pp249',  'عبدالرحيم@77,106', 'عبدالكريم@90,106 should be child of عبدالرحيم@77,106 (R3)'),
]

for child_id, from_pp_id, to_pp_id, correct_parent, reason in spine_chain:
    move_child(child_id, from_pp_id, to_pp_id, reason)

# =============================================================================
# SECTION 3: R2 CORRECTIONS - عبدالكريم@90,106 children
# =============================================================================
print("\n--- R2: عبدالكريم@90,106 children corrections ---")

# Current (wrong):
# p705(عبدالكريم) -> pp291 -> [p706(احمد@93,131), p707(قاسم@93,157)]
# p706(احمد@93) -> pp292 -> [p708(زكي@95,109), p709(فريد@95,115), p710(سعيد@95,131), p711(يوسف@95,143)]
# p707(قاسم@93) -> [p712(نادر@95,145), p713(عبدالكريم@95,157)]
#
# Correct per R2:
# p705(عبدالكريم@90) -> DIRECT children: [p706(احمد@93), p707(قاسم@93), p708(زكي@95), p709(فريد@95)]
# p706(احمد@93) -> children: [p710(سعيد@95,131), p711(يوسف@95,143)]
# p707(قاسم@93) -> children: [p712(نادر@95,145), p713(عبدالكريم@95,157)] -- already correct

# Move p708(زكي) and p709(فريد) from p706(احمد)'s pp292 to p705's pp291
pp292 = pp_by_id.get('pp292')
pp291 = pp_by_id.get('pp291')

if pp292 and pp291:
    move_child('p708', 'pp292', 'pp291',
               'زكي@95,109 is direct child of عبدالكريم@90,106, not of احمد@93,131 (R2 canonical)')
    move_child('p709', 'pp292', 'pp291',
               'فريد@95,115 is direct child of عبدالكريم@90,106, not of احمد@93,131 (R2 canonical)')

# =============================================================================
# SECTION 4: Fix تقيالدين branch - معتز محمود should be under تقيالدين
# =============================================================================
print("\n--- R1: تقيالدين branch - معتز محمود correction ---")
# R1 says: تقيالدين@29,127 -> [منتصر@31,127, معتصم@31,128, معتز محمود@31,130]
# Current: p206(تقيالدين) has [p231(منتصر), p232(معتصم)] but NOT p233(معتز محمود)
#          p233 is currently under p207(حسن)
pp_for_p206 = None
for pp in person_to_pp_as_parent['p206']:
    pp_for_p206 = pp
    break
pp_for_p233 = child_to_partnership.get('p233')
if pp_for_p206 and pp_for_p233:
    move_child('p233', pp_for_p233['id'], pp_for_p206['id'],
               'معتز محمود@31,130 is child of تقيالدين@29,127 not of حسن (R1 canonical)')

# =============================================================================
# Summary output
# =============================================================================
print("\n" + "=" * 70)
print(f"TOTAL CORRECTIONS: {len(corrections_log)}")
print("=" * 70)

# Save corrections log
corrections_summary = {
    'total_corrections': len(corrections_log),
    'corrections': corrections_log
}
with open('/Users/rjioussy/work/projects/familytree/tree_analysis/corrections_applied.json', 'w', encoding='utf-8') as f:
    json.dump(corrections_summary, f, ensure_ascii=False, indent=2)
print("Corrections log saved to corrections_applied.json")

# Write corrected family_data.js
output = 'const familyData = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';'
with open('/Users/rjioussy/work/projects/familytree/family_data.js', 'w', encoding='utf-8') as f:
    f.write(output)
print("Corrected family_data.js written successfully!")

# Verify key corrections
print("\n--- VERIFICATION ---")
# Rebuild lookups
person_to_pp_as_parent2 = defaultdict(list)
for pp in partnerships:
    for partner in pp['partners']:
        if partner is not None:
            person_to_pp_as_parent2[partner].append(pp)

def get_children(pid):
    children = []
    for pp in person_to_pp_as_parent2[pid]:
        children.extend(pp['children'])
    return children

print("واكد(p15) children:", [(c, people[c]['name']) for c in get_children('p15')])
print("مصطفى(p126) children:", [(c, people[c]['name']) for c in get_children('p126')])
print("عبدالرحمن(p243) children:", [(c, people[c]['name']) for c in get_children('p243')][:5])
print("عبدالكريم@90(p705) children:", [(c, people[c]['name']) for c in get_children('p705')])
print("احمد@93(p706) children:", [(c, people[c]['name']) for c in get_children('p706')])
