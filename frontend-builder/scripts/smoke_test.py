"""Local UI smoke tests. Requires Python Playwright + Chromium; no app backend."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import re
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / 'artifacts'
ARTIFACTS.mkdir(exist_ok=True)
checks = []
errors = []
external_requests = []

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print(f'PASS {label}', flush=True)


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT / 'dist')))
Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        page.set_default_timeout(6000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: external_requests.append(request.url) if not request.url.startswith(base) else None)
        page.add_init_script("""window.__fileReads = 0;
          const originalText = File.prototype.text;
          File.prototype.text = function() { window.__fileReads++; return originalText.call(this); };
          const originalRead = FileReader.prototype.readAsText;
          FileReader.prototype.readAsText = function() { window.__fileReads++; return originalRead.apply(this, arguments); };
        """)
        page.goto(base, wait_until='networkidle')
        def nav(name):
            page.get_by_role('link', name=name, exact=True).click()
            page.wait_for_timeout(200)
        def screenshot(name, full=False):
            page.screenshot(path=str(ARTIFACTS / f'{name}.png'), full_page=full)
        def close_dialog():
            page.keyboard.press('Escape')
            expect(page.get_by_role('dialog')).to_have_count(0)

        check(page.title() == 'Atlas FP&A', 'App title and local branding')
        check(page.locator('.kpi-value').all_inner_texts() == ['3,100', '2,250', '850', 'Not provided'], 'Default figures match supplied AED-thousands dataset')
        check(page.locator('.prototype-mark').inner_text() == 'Prototype · Synthetic data', 'Persistent synthetic-data badge')
        check('Offline demo' in page.locator('.offline-status').inner_text(), 'Honest offline-demo status')
        check('Unadjusted management total' in page.locator('tfoot').inner_text(), 'Total is explicitly unadjusted')
        page.wait_for_timeout(250)
        screenshot('atlas-overview-1440')
        table_box = page.locator('.business-card').bounding_box()
        check(table_box['y'] + table_box['height'] <= 900, 'Default business total fits 1440 × 900 viewport')

        page.get_by_role('button', name=re.compile(r'^Revenue: 3,100')).click()
        expect(page.get_by_role('dialog')).to_be_visible()
        check('Fictional provenance' in page.get_by_role('dialog').inner_text(), 'KPI opens fictional source lineage')
        screenshot('atlas-source-drawer')
        close_dialog()
        check(page.evaluate('document.activeElement.classList.contains("kpi-card")'), 'Dialog restores keyboard focus')
        for scope, values in [('packaging', ['1,000', '750', '250', 'Not provided']), ('metals', ['1,600', '1,300', '300', 'Not provided']), ('property', ['500', '200', '300', 'Not provided'])]:
            page.get_by_label('Entity or group scope', exact=True).select_option(scope)
            check(page.locator('.kpi-value').all_inner_texts() == values, f'Entity selector updates {scope} consistently')
        page.get_by_label('Entity or group scope', exact=True).select_option('group')
        page.get_by_label('Reporting period', exact=True).select_option('nov')
        check(page.locator('.kpi-value').all_inner_texts() == ['2,860', '2,120', '740', 'Not provided'], 'Historical period changes visible fixture')
        page.get_by_label('Reporting period', exact=True).select_option('jan')
        page.get_by_label('Reporting scenario', exact=True).select_option('budget')
        check(page.locator('.kpi-value').all_inner_texts() == ['3,000', '2,200', '800', 'Not provided'], 'Budget selector changes all KPI figures')
        page.get_by_label('Reporting scenario', exact=True).select_option('forecast')
        check(page.locator('.kpi-value').all_inner_texts() == ['3,140', '2,250', '890', 'Not provided'], 'Forecast matches base planning fixture')
        page.get_by_label('Reporting scenario', exact=True).select_option('actual')
        page.get_by_role('group', name='Trend measure').get_by_role('button', name='Expenses', exact=True).click()
        check('Operating expenses' in page.locator('.trend-card .card-header').inner_text(), 'Trend measure tab updates chart')
        page.get_by_role('group', name='Chart display').get_by_role('button', name='Table', exact=True).click()
        check('2,250' in page.locator('.trend-table tbody tr').last.inner_text(), 'Accessible chart table exposes numeric values')
        page.get_by_role('group', name='Chart display').get_by_role('button', name='Chart', exact=True).click()
        page.get_by_role('group', name='Business comparison measure').get_by_role('button', name='Operating result', exact=True).click()
        check(page.locator('.business-card thead').inner_text().find('Actual result') >= 0, 'Business variance tab updates comparison measure')
        page.get_by_role('button', name=re.compile(r'^Cash balance:')).click()
        check(page.get_by_role('tab', name='Cash flow', exact=True).get_attribute('aria-selected') == 'true', 'Cash KPI opens missing-input statement')
        check(page.locator('tbody .missing-cell').count() == 12, 'Unsupplied cash-flow cells remain Not provided')
        page.get_by_role('tab', name='Balance sheet', exact=True).click()
        check(page.locator('tbody .missing-cell').count() == 14, 'Balance sheet never invents values')
        page.get_by_role('tab', name='Income statement', exact=True).click()
        page.get_by_role('button', name='Collapse Revenue', exact=True).click()
        check(page.locator('.statement-child').count() == 0, 'Statement groups collapse')
        page.get_by_role('button', name='Expand Revenue', exact=True).click()
        check(page.locator('.statement-child').count() == 3, 'Statement groups expand by business')
        page.get_by_role('button', name='Revenue', exact=True).click()
        check('3,100' in page.get_by_role('dialog').inner_text(), 'Statement row opens coherent source detail')
        close_dialog()
        screenshot('atlas-statements')

        nav('Planning & scenarios')
        page.get_by_label('Demo scenario', exact=True).select_option('5')
        check(page.locator('.plan-comparison tbody tr').first.locator('td').nth(2).inner_text() == '3,297', 'Upside uses fixed consistent revenue preview')
        check(page.locator('.plan-comparison tbody tr').nth(2).locator('td').nth(2).inner_text() == '1,047', 'Upside operating result is consistent')
        page.get_by_label('Revenue uplift / reduction').fill('2')
        page.get_by_role('button', name='Apply demo preview', exact=True).click()
        check('Only these fixed' in page.get_by_role('alert').inner_text(), 'Unsupported assumption displays validation error')
        page.get_by_label('Revenue uplift / reduction').fill('-5')
        page.get_by_role('button', name='Apply demo preview', exact=True).click()
        check(page.locator('.plan-comparison tbody tr').first.locator('td').nth(2).inner_text() == '2,983', 'Local assumption edit selects cautious fixture')
        page.get_by_role('button', name='Reset demo', exact=True).click()
        check(page.locator('.plan-comparison tbody tr').first.locator('td').nth(2).inner_text() == '3,140', 'Planning reset restores base case')
        page.get_by_label('Planning month', exact=True).select_option('feb')
        check(page.locator('.plan-comparison tbody tr').first.locator('td').first.inner_text() == 'Not provided', 'Future actuals stay missing rather than zero')
        page.get_by_label('Planning month', exact=True).select_option('jan')
        screenshot('atlas-planning')

        nav('Group consolidation')
        page.get_by_role('button', name=re.compile('Currencies & rates')).click()
        page.get_by_role('button', name='Inspect', exact=True).click()
        check('Not provided' in page.get_by_role('dialog').inner_text() and 'No rate is invented' in page.get_by_role('dialog').inner_text(), 'Missing FX reference has honest drill-down')
        close_dialog()
        page.get_by_role('button', name=re.compile(r'^4 Intercompany')).click()
        page.get_by_role('button', name='Inspect', exact=True).click()
        check('120 AED thousands' in page.get_by_role('dialog').inner_text() and '110 AED thousands' in page.get_by_role('dialog').inner_text(), 'Intercompany mismatch is a separate labeled fixture')
        close_dialog()
        page.get_by_role('button', name=re.compile(r'^6 Review')).click()
        check(page.get_by_role('button', name='Consolidation unavailable', exact=True).is_disabled(), 'Fake final consolidation is prevented')
        check('No consolidated output is available' in page.locator('main').inner_text(), 'Review remains explicitly incomplete')
        screenshot('atlas-consolidation')

        nav('Data imports')
        page.get_by_role('button', name=re.compile('Excel layout')).click()
        check('Workbook reading is not implemented' in page.locator('main').inner_text(), 'Excel source type exposes implementation boundary')
        page.get_by_role('button', name=re.compile('CSV file')).click()
        with page.expect_download() as download_event:
            page.get_by_role('link', name=re.compile('Download the synthetic CSV')).click()
        check(download_event.value.suggested_filename == 'synthetic-january-2026.csv', 'Bundled synthetic CSV download works')
        page.get_by_role('button', name='Use provided example', exact=True).click()
        page.get_by_label('Target for revenue_thousands', exact=True).select_option('')
        check('Mapping error' in page.locator('main').inner_text(), 'Unmapped field is distinct from missing value')
        page.get_by_role('button', name='Continue', exact=True).click()
        page.get_by_role('button', name='Run demo checks', exact=True).click()
        check(page.locator('.loading-state').is_visible(), 'Validation shows simulated loading state')
        expect(page.get_by_role('button', name='Replay demo checks', exact=True)).to_be_visible()
        check('0 · Explicit zero' in page.locator('main').inner_text() and 'Validation error' in page.locator('main').inner_text(), 'Missing, explicit zero, and errors are separate')
        screenshot('atlas-import-validation')
        check(page.get_by_role('button', name='Continue', exact=True).is_disabled(), 'Unmapped fields prevent the confirmation step')
        page.get_by_role('button', name='Fix mappings', exact=True).click()
        page.get_by_label('Target for revenue_thousands', exact=True).select_option('Revenue')
        page.get_by_role('button', name='Continue', exact=True).click()
        page.get_by_role('button', name='Run demo checks', exact=True).click()
        expect(page.get_by_role('button', name='Replay demo checks', exact=True)).to_be_visible()
        page.get_by_role('button', name='Continue', exact=True).click()
        page.get_by_role('button', name='Confirm demo', exact=True).click()
        check(page.get_by_role('dialog').get_by_role('heading', name='Demo only — no financial data committed', exact=True).is_visible(), 'Import confirmation states no data committed')
        close_dialog()
        page.get_by_role('button', name='Reset flow', exact=True).click()
        page.get_by_label('Choose a local synthetic CSV for filename display only', exact=True).set_input_files({'name':'local-synthetic-test.csv','mimeType':'text/csv','buffer':b'never-render-this-content,999999\n'})
        check('local-synthetic-test.csv' in page.locator('main').inner_text(), 'Local upload displays filename only')
        page.get_by_role('button', name='Continue', exact=True).click()
        check('never-render-this-content' not in page.locator('main').inner_text(), 'Uploaded content is not rendered or parsed')
        check(page.evaluate('window.__fileReads') == 0, 'No FileReader or File.text content reads')

        nav('Excel integration')
        page.get_by_role('button', name='Simulate data pull', exact=True).click()
        expect(page.get_by_role('dialog')).to_be_visible()
        check('No Excel process' in page.get_by_role('dialog').inner_text(), 'Data pull is explicitly simulated')
        close_dialog()
        check('Stale preview example' in page.locator('main').inner_text(), 'Stale warning remains without live freshness claims')
        screenshot('atlas-excel')
        page.get_by_role('tab', name='Write-back preview', exact=True).click()
        page.get_by_label('Proposed value · AED thousands', exact=True).fill('-5')
        page.get_by_role('button', name='Review write-back preview', exact=True).click()
        check(page.get_by_role('alert').is_visible(), 'Invalid write preview has visible error')
        page.get_by_label('Proposed value · AED thousands', exact=True).fill('1050')
        page.get_by_role('button', name='Review write-back preview', exact=True).click()
        check('1,050 AED thousands' in page.get_by_role('dialog').inner_text(), 'Explicit write-back review shows proposed value')
        page.get_by_role('button', name='Simulate confirmation', exact=True).click()
        check('Simulation ended — nothing was written' in page.get_by_role('dialog').inner_text(), 'Write simulation never claims real success')
        close_dialog()
        nav('Overview')
        check(page.locator('.kpi-value').all_inner_texts() == ['3,100', '2,250', '850', 'Not provided'], 'Mock import and Excel actions leave fixture unchanged')

        nav('Audit & activity')
        check(page.locator('.data-table tbody tr').count() == 6, 'Activity remains six static mock entries')
        page.get_by_label('Search mock activity', exact=True).fill('no-such-actor')
        check(page.get_by_role('heading', name='No matching mock entries', exact=True).is_visible(), 'Activity search has useful empty state')
        page.get_by_role('button', name='Clear filters', exact=True).click()
        page.get_by_label('Filter activity category', exact=True).select_option('Issue')
        check(page.locator('.data-table tbody tr').count() == 2, 'Activity category filter works')
        page.get_by_role('button', name='Open MOCK-004 details', exact=True).click()
        check('Not a real audit event' in page.get_by_role('dialog').inner_text(), 'Mock activity opens clear contextual detail')
        close_dialog()
        page.get_by_label('Filter activity category', exact=True).select_option('all')
        screenshot('atlas-activity')

        nav('Settings')
        page.get_by_role('switch', name='Compact data tables', exact=True).click()
        page.get_by_role('switch', name='Use digit grouping', exact=True).click()
        page.get_by_role('switch', name='Reduce interface motion', exact=True).click()
        check(page.locator('.app-shell').get_attribute('class').find('compact-tables') >= 0, 'Density toggle changes workspace styles')
        check(page.locator('.app-shell').get_attribute('class').find('reduce-motion') >= 0, 'Motion preference visibly changes animation state')
        page.get_by_label('Fictional workspace label', exact=True).fill('Juniper Demo Group')
        page.get_by_role('button', name='Apply local label', exact=True).click()
        check(page.get_by_label('Workspace', exact=True).locator('option:checked').inner_text() == 'Juniper Demo Group', 'Fictional local label updates toolbar')
        screenshot('atlas-settings')
        nav('Overview')
        check(page.locator('.kpi-value').first.inner_text() == '3100', 'Digit grouping preference changes rendered values')
        nav('Settings')
        page.get_by_role('button', name='Reset entire demo', exact=True).click()
        page.get_by_role('button', name='Reset local demo', exact=True).click()
        check(page.locator('.kpi-value').first.inner_text() == '3,100' and page.get_by_label('Workspace', exact=True).locator('option:checked').inner_text() == 'Aster Vale Group', 'Full reset restores original session state')
        page.get_by_label('Workspace', exact=True).select_option('blank')
        check(page.get_by_role('heading', name='A workspace with room to begin', exact=True).is_visible(), 'Workspace selector exposes intentionally empty state')
        check(page.locator('.kpi-card').count() == 0, 'Empty workspace does not display invented zero values')
        page.get_by_role('button', name='Open sample workspace', exact=True).click()
        page.keyboard.press('Control+k')
        expect(page.get_by_role('dialog')).to_be_visible()
        page.get_by_label('Search screens and demo workflows', exact=True).fill('cash')
        page.get_by_label('Search screens and demo workflows', exact=True).press('Enter')
        check(page.get_by_role('tab', name='Cash flow', exact=True).get_attribute('aria-selected') == 'true', 'Ctrl+K search navigates to matching workflow')

        nav('Overview')
        pages = ['overview', 'statements', 'planning', 'consolidation', 'imports', 'excel', 'activity', 'settings']
        for width,height in [(1024,900), (390,844), (360,800)]:
            page.set_viewport_size({'width':width,'height':height})
            for route in pages:
                page.goto(f'{base}/#/{route}', wait_until='networkidle')
                page.wait_for_timeout(180)
                actual_width = page.evaluate('document.documentElement.scrollWidth')
                if actual_width > width:
                    screenshot(f'overflow-{route}-{width}', full=True)
                check(actual_width <= width, f'{route} usable at {width}px without page overflow')
                if route == 'overview':
                    screenshot(f'atlas-overview-{width}', full=True)
            if width == 390:
                page.goto(f'{base}/#/overview')
                page.get_by_role('button', name='Open navigation', exact=True).click()
                page.get_by_role('link', name='Planning & scenarios', exact=True).click()
                check(page.locator('h1').inner_text() == 'Planning & scenarios', 'Mobile navigation opens a real screen')
                page.evaluate('window.scrollTo(0, 700)')
                check(page.locator('.prototype-strip').bounding_box()['y'] >= 90, 'Synthetic-data indicator remains visible while scrolling mobile')
        check(page.evaluate('localStorage.length') == 0 and page.evaluate('sessionStorage.length') == 0, 'No browser storage used')
        check(len(external_requests) == 0, 'No external runtime requests')
        check(len(errors) == 0, 'No browser runtime errors')
        report = {'passed': len(checks), 'checks': checks, 'runtime_errors': errors, 'external_requests': external_requests}
        (ARTIFACTS / 'test-report.json').write_text(json.dumps(report, indent=2))
        print(f'\nPASS: {len(checks)} checks. No browser errors. No external runtime requests.', flush=True)
        browser.close()
finally:
    server.shutdown()
    server.server_close()
