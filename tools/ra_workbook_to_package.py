"""Converts a Cryptika risk-assessment workbook (the "RA Full plan" layout) into an import package for GRC Hub.

    python3 tools/ra_workbook_to_package.py "<workbook.xlsx>" data/imports/<name>.json --name "<Organisation>" --sector Government --country "Saudi Arabia"

Values are copied as they are in the workbook. Three things are derived, and listed in the package's "notes":
  * one asset per server address (web applications tested by URL become one asset each);
  * severity capitalisation is normalised (HIGH -> High);
  * NCA reference codes in the dashboards are split into single control IDs.
Requires Python 3 with openpyxl. The application itself does not need Python.
"""
import argparse, json, re, sys, collections, warnings
import openpyxl
warnings.filterwarnings('ignore')

def filled_rows(ws, first_row, ncols):
    """Rows as lists, with merged cells carrying their value to every row they span."""
    fill = {}
    for mr in ws.merged_cells.ranges:
        v = ws.cell(mr.min_row, mr.min_col).value
        for r in range(mr.min_row, mr.max_row + 1):
            for c in range(mr.min_col, mr.max_col + 1): fill[(r, c)] = v
    out = []
    for r in range(first_row, ws.max_row + 1):
        raw = [ws.cell(r, c).value for c in range(1, ncols + 1)]
        if not any(v is not None for v in raw): continue
        out.append([fill.get((r, c), ws.cell(r, c).value) for c in range(1, ncols + 1)])
    return out

txt = lambda v: '' if v is None else str(v).replace('_x000D_', '').strip()
num = lambda v: v if isinstance(v, (int, float)) and not isinstance(v, bool) else (float(v) if re.fullmatch(r'\d+(\.\d+)?', txt(v)) else None)
IP = re.compile(r'^\d+\.\d+\.\d+\.\d+$')
CODE = re.compile(r'\b\d+-\d+(?:-\d+){0,2}\b')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('workbook'); ap.add_argument('out'); ap.add_argument('--name', required=True); ap.add_argument('--sector', default='Government'); ap.add_argument('--country', default='Saudi Arabia')
    ap.add_argument('--package', default=None); a = ap.parse_args()
    wb = openpyxl.load_workbook(a.workbook, data_only=True); notes = []

    # ── Per-host findings (latest "Server Count" sheet) ──
    sheet = sorted([n for n in wb.sheetnames if re.match(r'Server Count - Macca V\d+$', n)], key=lambda n: int(re.search(r'V(\d+)$', n).group(1)))[-1]
    ws = wb[sheet]; hdr = [txt(ws.cell(1, c).value) for c in range(1, 22)]; col = {h: i for i, h in enumerate(hdr)}
    rows = filled_rows(ws, 2, 21)
    g = lambda r, h: r[col[h]]
    crit = {txt(r[2]): r for r in filled_rows(wb['Asset criticallity scoring (2)'], 2, 8)}
    assets, vulns, cats = {}, [], collections.OrderedDict()
    for r in rows:
        an, host, url = txt(g(r, 'Asset name')), txt(g(r, 'Host')), txt(g(r, 'URL'))
        is_ip = bool(IP.match(host)); key = f'{an}|{host}' if is_ip else an
        if key not in assets:
            assets[key] = {'key': key, 'name': f'{an} — {host}' if is_ip else an, 'asset_type': txt(g(r, 'Asset Category Macca')), 'ip_address': host if is_ip else None,
                'hostname': None, 'criticality': int(num(g(r, 'Asset value')) or 3),
                'description': f"{txt(g(r, 'Asset Group Macca'))} · {an} · C {txt(g(r, 'C'))} · I {txt(g(r, 'I'))} · A {txt(g(r, 'A'))} · {txt(g(r, 'Asset Rating'))} · Location {txt(g(r, 'Asset Location'))}"}
        if not is_ip and url and not assets[key]['hostname']:
            m = re.search(r'^(?:https?://)?([^/:]+)', url); assets[key]['hostname'] = m.group(1) if m else None
        cat = txt(g(r, 'Vulnerability Category')); cats.setdefault(cat, None)
        title = txt(g(r, 'Vulnerabiltiy asset based')); orig = txt(g(r, 'Original Vulnerability'))
        desc = [f"{txt(g(r, 'Vulnerability High Level'))} › {cat}"]
        if orig and orig != title: desc.append(f'Scanner finding: {orig}')
        if url: desc.append(f'URL: {url}')
        if not is_ip and host: desc.append(f'Finding ID: {host}')
        sev = txt(g(r, 'Severity')); vulns.append({'asset': key, 'threat': txt(g(r, 'Threats')), 'title': title, 'severity': sev.capitalize() if sev else None, 'cve': txt(g(r, 'CVE')) or None, 'category': cat,
            'description': '\n'.join(desc), 'solution': txt(g(r, 'Solution/Recommendation')) or None, 'source': txt(g(r, 'Vulnerability Registration Source')) or 'import'})
    if any(txt(g(r, 'Severity')) != txt(g(r, 'Severity')).capitalize() for r in rows): notes.append('Severity capitalisation normalised (e.g. HIGH -> High).')
    notes.append(f'Findings read from sheet "{sheet}": {len(rows)} rows; {len(assets)} assets derived (one per server address; applications tested by URL are one asset each).')

    # category descriptions from the normalised vulnerability list
    for r in filled_rows(wb['Vulnerabilities asset based'], 2, 4):
        name = txt(r[1]).split(':')[0].strip()
        if name in cats: cats[name] = txt(r[2]) or None

    # ── Threat lists ──
    threats = collections.OrderedDict()
    for sheet_name, label in (('Threats asset based', 'Asset-based'), ('Threats process based', 'Process-based')):
        for r in filled_rows(wb[sheet_name], 2, 3):
            if txt(r[0]) and txt(r[1]): threats[txt(r[1])] = {'key': txt(r[1]), 'ref': txt(r[0]), 'name': txt(r[1]), 'category': label, 'description': txt(r[2]) or None}
    extra = 0
    def threat_key(name, label):
        nonlocal extra
        name = txt(name)
        if name and name not in threats: extra += 1; threats[name] = {'key': name, 'ref': f'T-X-{extra:03d}', 'name': name, 'category': label, 'description': None}
        return name or None
    for v in vulns: threat_key(v['threat'], 'Asset-based')

    # ── Risk dashboards ──
    risks, assessments = collections.OrderedDict(), []
    def dashboard(sheet_name, title, prefix, purpose):
        ws = wb[sheet_name]; width = ws.max_column; hdr = [txt(ws.cell(2, c).value) for c in range(1, width + 1)]; H = {h: i for i, h in enumerate(hdr)}
        raw_ids = {}
        for r in range(3, ws.max_row + 1): raw_ids[r] = ws.cell(r, 1).value
        body = filled_rows(ws, 3, width); items = []; seen = collections.Counter(); matched = collections.Counter()
        for r in body:
            get = lambda h: r[H[h]] if h in H else None
            L, I = num(get('Likelihood')), num(get('Impact'))
            if L is None or I is None or not txt(get('Threat Description')): continue
            rid = txt(get('ID')); seen[rid] += 1
        counts = dict(seen); seen = collections.Counter()
        for r in body:
            get = lambda h: r[H[h]] if h in H else None
            L, I = num(get('Likelihood')), num(get('Impact')); threat = txt(get('Threat Description'))
            if L is None or I is None or not threat: continue
            rid = txt(get('ID')); seen[rid] += 1; ref = f'{prefix}-{rid}' + (f'.{seen[rid]}' if counts[rid] > 1 else '')
            cat_ = txt(get('Asset Category')); process = cat_ == 'Process'
            hi = txt(get('Vulnerability High Level')); vcat = txt(get('Vulnerability Category')); vdesc = txt(get('Vulnerability Description'))
            if not process and not hi: hi = vdesc.split('\n')[0]
            rkey = f'{threat}|{hi}' if process else f'{threat}|{cat_}'
            if rkey not in risks:
                parts = [txt(get('Risk Scenario'))]
                if process: parts.append(f'Weakness: {hi}' + (f' › {vcat}' if vcat else '') + (f' — {vdesc}' if vdesc else ''))
                else: parts.append('Weaknesses: ' + '; '.join(x.strip() for x in vdesc.split('\n') if x.strip()))
                risks[rkey] = {'key': rkey, 'ref': ref, 'title': f'{threat} — {hi}' if process else f'{threat} — {cat_} assets', 'description': '\n'.join(p for p in parts if p),
                    'risk_type': 'cyber', 'category': 'Process-based' if process else 'Asset-based', 'threat': threat_key(threat, 'Process-based' if process else 'Asset-based')}
            inh, res, factor = num(get('Inherent Risk Score')), num(get('Residual Risk Score')), num(get('Control Effectiveness Score'))
            decision = txt(get('Risk Management Decision')).upper(); treatment = {'REDUCE': 'mitigate', 'ACCEPT': 'accept', 'TRANSFER': 'transfer', 'AVOID': 'avoid'}.get(decision)
            controls = []
            for fw, h in (('NCA ECC', 'ECC Reference Code(s)'), ('NCA CSCC', 'CSCC Reference Code(s)')):
                for code in dict.fromkeys(CODE.findall(txt(get(h)))): controls.append({'framework': fw, 'ref': code})
            existing = None
            if inh is not None and res is not None and abs(inh - res) > 1e-9:
                existing = {'text': f'Existing controls — rated at effectiveness factor {txt(factor)} in the source assessment (residual = inherent ÷ {txt(factor)})', 'effectiveness': round((inh - res) / 5, 4)}
                if not treatment: treatment = 'mitigate'
            owner = ' / '.join(x for x in (txt(get('Risk Owner')).replace('\n', ' '), txt(get('Responsibility to Mitigate Risk')).replace('\n', ' ')) if x)
            items.append({'risk': rkey, 'source_ref': ref, 'likelihood': L, 'impact': I, 'treatment': treatment, 'treatment_plan': txt(get('Suggested Controls to Mitigate Risk')) or None, 'treatment_owner': owner or None,
                'notes': f"Threat impact {txt(get('Threat Impact'))} · asset value {txt(get('Asset value'))} (C {txt(get('C'))} · I {txt(get('I'))} · A {txt(get('A'))}, {txt(get('Asset Rating'))}) · source rating {txt(get('Inherent Risk'))} → {txt(get('Residual Risk Rating'))}",
                'controls': controls, 'existing_control': existing, 'expect': {'inherent': inh, 'residual': res}})
        assessments.append({'name': title, 'purpose': purpose, 'basis': 'Risk assessment workbook — ' + re.sub(r'-\s+', '-', sheet_name.strip()), 'items': items})
    dashboard(' Asset based risk dashboard', 'Asset-based risk assessment', 'A', 'Risks arising from technical weaknesses found on assets.')
    dashboard('Process based risk dashboard', 'Process-based risk assessment', 'P', 'Risks arising from weaknesses in security processes.')
    dashboard('Third- Party risk dashboard', 'Third-party risk assessment', 'TP', 'Risks that involve third parties and service providers.')
    notes.append('Residual scores in the workbook are inherent ÷ effectiveness factor. They are reproduced exactly by recording the existing controls with an equivalent effectiveness on the 0–5 scale (inherent − residual) ÷ 5.')

    pkg = {'package': a.package or re.sub(r'[^a-z0-9]+', '-', a.name.lower()).strip('-') + '-ra', 'organisation': {'name': a.name, 'sector': a.sector, 'country': a.country},
        'frameworks': ['NCA ECC-2:2024', 'NCA CSCC'], 'categories': [{'name': k, 'description': v} for k, v in cats.items()], 'assets': list(assets.values()), 'threats': list(threats.values()),
        'vulnerabilities': vulns, 'risks': list(risks.values()), 'assessments': assessments, 'notes': notes}
    json.dump(pkg, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in pkg.items() if k not in ('organisation', 'notes')}, indent=1)); print('\n'.join(notes))
    for s in assessments: print(s['name'], len(s['items']), 'items;', sum(len(i['controls']) for i in s['items']), 'control references;', sum(1 for i in s['items'] if i['existing_control']), 'with existing controls')

if __name__ == '__main__': main()
