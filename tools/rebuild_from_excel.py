#!/usr/bin/env python3
"""
Rebuild family_data.js from the 1999 Excel source's DRAWN CONNECTOR LINES.

Supersedes apply_corrections.py, whose rulings rest on a false premise: it
inferred descent from cell proximity, but the workbook encodes descent in 3,990
Escher line shapes. Its very first correction (moving p126 مصطفى from p81 سعيد
to p15 واكد) reverses an edge the drawing gets right.

Input:  tree_analysis/derived_edges.json  (1,626 edges recovered from the
        drawing layer of ~/Downloads/jioussy_family_tree_Jayyousi.xls)
Output: family_data.rebuilt.js            (same schema as family_data.js)
        tree_analysis/rebuild_provenance.json  (per-edge evidence class)

Nothing is written over family_data.js. Compare, then swap deliberately.
"""

import json
import os
from collections import defaultdict

# This script lives in tools/, so the repo root is one level up. Getting this
# wrong silently resolves to tools/tree_analysis/ and the script cannot find
# its own input.
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DERIVED = os.path.join(REPO, 'tree_analysis', 'derived_edges.json')
CURRENT = os.path.join(REPO, 'data', 'family.js')
OUT = os.path.join(REPO, 'data', 'family.rebuilt.js')
PROV = os.path.join(REPO, 'tree_analysis', 'rebuild_provenance.json')

# A section heading the source draws in a bordered box like a person, and which
# the app carries as a person with a father. "The Jayyousi family in the town of
# Katm". It is a leaf in the derived graph, so removing it detaches nothing.
NOT_A_PERSON = {'p1131'}

# The deriver's "never merge two horizontals" rule prevents fusing two families
# whose sibling buses overlap, but it also splits a single bus drawn as two
# overlapping strokes. This edge IS drawn (buses x 7289.1->7840.4 and
# 7831.9->8021.6 at y=430.4) and carries the 16-son bracket; the app's own data
# agrees independently.
MANUAL_EDGES = [('p7', 'p11', 'manual_verified_falseneg')]

# The one bracket son whose stub was never drawn. His cell sits on the bus
# between two confirmed sons of p11. Positional inference, not a drawn line.
INFERRED_EDGES = [('p11', 'p1453', 'inferred_positional')]

# Two parent stubs both reach p1651. The app independently picks p1554, which is
# one of the two candidates, so the tie is broken on evidence, not by coin flip.
INDEGREE_TIEBREAK = {'p1651': 'p1554'}


def id_key(x):
    """Sort key that survives post-1999 ids.

    The 1,746 imported ids are 'p' plus a number, and every sort here used
    int(x[1:]). People added through admin.html now carry random ids like
    'p3f9k2m7' — the old incremental counter handed the same id to two editors
    — and int() raises ValueError on those. Numeric ids keep their original
    order and sort first; random ids follow as text, so output stays
    deterministic either way.
    """
    tail = x[1:]
    return (0, int(tail), '') if tail.isdigit() else (1, 0, x)


def load_current():
    """Parse data/family.js, which wraps the object as a window global."""
    raw = open(CURRENT, encoding='utf-8').read()
    start = raw.index('{')
    end = raw.rindex('};') + 1
    return json.loads(raw[start:end])


def main():
    derived = json.load(open(DERIVED, encoding='utf-8'))
    current = load_current()

    people_src = derived['people']
    app_parent = {c: pp['partners'][0]
                  for pp in current['partnerships'] for c in pp['children']}

    parent = {}
    evidence = {}

    # 1. Drawn edges, resolving the single indegree-2 conflict.
    for e in derived['edges']:
        child, p = e['child'], e['parent']
        if child in INDEGREE_TIEBREAK and p != INDEGREE_TIEBREAK[child]:
            continue
        parent[child] = p
        evidence[child] = e['evidence']

    # 2. Manually verified edges, then positional inference.
    for p, c, tag in MANUAL_EDGES + INFERRED_EDGES:
        if c not in parent:
            parent[c], evidence[c] = p, tag

    # 3. Fall back to the app's edge where the drawing yields nothing, rather
    #    than detaching the person. 65 of the unparented carry subtrees. Reject
    #    any fallback that would close a cycle against the drawn structure.
    def creates_cycle(child, cand):
        seen, cur = set(), cand
        while cur is not None and cur not in seen:
            if cur == child:
                return True
            seen.add(cur)
            cur = parent.get(cur)
        return False

    skipped = []
    for person in sorted(people_src, key=id_key):
        if person in parent or person == current['root']:
            continue
        cand = app_parent.get(person)
        if cand is None or cand in NOT_A_PERSON or cand not in people_src:
            continue
        if creates_cycle(person, cand):
            skipped.append((person, cand))
            continue
        parent[person], evidence[person] = cand, 'fallback_app'

    # 4. Drop the section heading.
    for ghost in NOT_A_PERSON:
        parent.pop(ghost, None)
        evidence.pop(ghost, None)
    keep = [i for i in people_src if i not in NOT_A_PERSON]
    parent = {c: p for c, p in parent.items()
              if c in people_src and p not in NOT_A_PERSON}

    # 5. generation := true depth from the root.
    def depth(i):
        n, cur, seen = 0, i, set()
        while cur in parent and cur not in seen:
            seen.add(cur)
            cur = parent[cur]
            n += 1
        return n

    gen = {i: depth(i) for i in keep}

    # 6. Emit, preserving the schema app.js expects: one partnership per parent,
    #    partners [father, null], relationships only in `partnerships`.
    people_out = {}
    for i in sorted(keep, key=id_key):
        src = current['people'].get(i, {})
        people_out[i] = {
            'id': i,
            'name': people_src[i]['name'],
            'gender': src.get('gender', 'male'),
            'generation': gen[i],
        }

    kids = defaultdict(list)
    for c, p in parent.items():
        kids[p].append(c)
    partnerships = []
    for n, p in enumerate(sorted(kids, key=id_key), start=1):
        partnerships.append({
            'id': 'pp%d' % n,
            'partners': [p, None],
            'children': sorted(kids[p], key=id_key),
        })

    out = {
        'people': people_out,
        'partnerships': partnerships,
        'loggedInUser': current['loggedInUser'],
        'root': current['root'],
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('window.FT_FAMILY = ' +
                json.dumps(out, ensure_ascii=False, indent=2) + ';\n' +
                'var familyData = window.FT_FAMILY;\n')

    prov = {
        'source': 'drawn connector lines (3990 Escher msosptLine shapes)',
        'superseded': 'apply_corrections.py (cell-proximity premise)',
        'removed_not_a_person': sorted(NOT_A_PERSON),
        'skipped_cyclic_fallbacks': skipped,
        'evidence_by_person': evidence,
    }
    json.dump(prov, open(PROV, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)

    ev_counts = defaultdict(int)
    for v in evidence.values():
        ev_counts[v.split(' ')[0]] += 1
    print('people        %d  (dropped %d non-person)'
          % (len(people_out), len(NOT_A_PERSON)))
    print('partnerships  %d' % len(partnerships))
    print('edges         %d' % len(parent))
    print('max depth     %d' % max(gen.values()))
    print('skipped cyclic fallbacks: %d %s' % (len(skipped), skipped[:5]))
    print('\nedge provenance:')
    for k, v in sorted(ev_counts.items(), key=lambda t: -t[1]):
        print('  %-32s %d' % (k, v))
    print('\nwrote %s' % OUT)
    print('wrote %s' % PROV)


if __name__ == '__main__':
    main()
