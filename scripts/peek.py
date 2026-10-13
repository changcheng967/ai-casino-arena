import json, sys
d = json.load(sys.stdin)
print('tables:', len(d['tables']), '| hands ever:', d['totalHandsEver'])
for t in d['tables']:
    print(f"{t['tierName']} {t['street']} pot={t['pot']} hand={t['handNumber']}/{t['maxHands']} acting_seat={t['currentSeat']}")
    for p in t['players']:
        flag = 'F' if p['folded'] else ('A' if p['allIn'] else '.')
        la = (p['lastAction'] or '')[:60]
        print(f"   {p['name'][:26]:26s} stack={p['stack']:>8} bet={p['bet']:>7} {flag} {la}")
