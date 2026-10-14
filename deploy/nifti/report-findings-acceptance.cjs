// Historical 2026-10-13 UI acceptance: selectors describe that snapshot.
// For current editing/save evidence see docs/WORKSPACE_PENDING_CHANGES.md.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:11028';
const out = process.env.OUTPUT_DIR || path.join(__dirname, 'results');
fs.mkdirSync(out, {recursive: true});
const receipt = JSON.parse(fs.readFileSync(process.env.IMPORT_RECEIPT || path.join(out, 'import-receipt.json')));
const snapshotFile = path.join(__dirname, 'workspace-snapshot.json');
const results = { snapshot: process.env.SNAPSHOT_SHA256 || (fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile)).snapshotSHA256 : null), manifestId: receipt.manifestId, checks: [], errors: [] };
const ok = (name, data) => { results.checks.push({ name, data }); console.log('PASS', name, JSON.stringify(data || {})); };
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ['--enable-unsafe-swiftshader', '--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  page.setDefaultTimeout(180000); page.on('pageerror', e => results.errors.push(e.message));
  try {
    const api = async suffix => { const r = await page.request.get(base + '/monai/api/annotation/v1' + suffix); assert.equal(r.status(), 200, await r.text()); return r.json(); };
    const context = async item => (await api(`/cases/${item.caseId}/context`)).data;
    const open = async (item, switchWithin = false) => {
      if (switchWithin) {
        await page.getByRole('button', { name: '病灶工作台', exact: true }).click();
        await page.getByRole('textbox', { name: '查找清单病例', exact: true }).fill(item.externalCaseId);
        await page.getByRole('button', { name: `打开病例 ${item.externalCaseId}`, exact: true }).click();
        await page.waitForFunction(id => new URL(location.href).searchParams.get('caseId') === id, item.externalCaseId);
      } else await page.goto(base + `/nifti?manifestId=${receipt.manifestId}&caseId=${item.externalCaseId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        try {
        const s = window.services, v = s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getState().activeViewportId);
        return v?.getCornerstoneImage?.() && v.getCurrentImageId() === v.getCornerstoneImage().imageId;
        } catch { return false; }
      });
      await page.locator(`.report-findings[data-case-id="${item.caseId}"]`).waitFor();
      const data = await context(item);
      assert.equal(data.reportExtraction.volumeName, item.externalCaseId + '.nii.gz');
      assert.equal(await page.locator('[data-finding-id]').count(), data.findings.length);
      await page.locator('.nw-case.active .nw-tree-finding').last().waitFor({state: data.findings.length ? 'visible' : 'hidden'});
      await page.locator('.nw-case.active .nw-case-pick small').filter({hasText: `${data.findings.length} Findings`}).waitFor();
      assert.equal(await page.locator('.nw-case.active .nw-tree-finding').count(), data.findings.length);
      assert.ok((await page.locator('.nw-case.active .nw-case-pick').innerText()).includes(`${data.findings.length} Findings`));
      const text = await page.locator('.rf-report-text').evaluateAll(nodes => nodes.map(n => n.textContent));
      assert.deepEqual(text, data.reports.flatMap(r => r.sections.map(s => s.text)));
      const viewport = await page.evaluate(() => {
        const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getState().activeViewportId), image = v.getCornerstoneImage();
        return { rows: image.rows, columns: image.columns, pixels: image.getPixelData().length, sourceId: s.niftiService?.getState?.().sourceId };
      });
      assert.ok(viewport.pixels > 0); ok('realCTAndMatchingReport', { volume: item.externalCaseId, caseId: item.caseId, findings: data.findings.length, ...viewport });
      return data;
    };
    const stats = () => page.evaluate(async () => {
      const cache = window.cornerstone.cache;
      return Promise.all(window.services.segmentationService.getSegmentations().map(async seg => {
        const ids = seg.representationData.Labelmap.imageIds;
        let size = 0; for (const id of ids) size += cache.getImage(id).voxelManager.getScalarData().length;
        const bytes = new Uint8Array(size); let offset = 0, count = 0;
        for (const id of ids) for (const x of cache.getImage(id).voxelManager.getScalarData()) { const b = x === 1 ? 1 : 0; bytes[offset++] = b; count += b; }
        return { segmentationId: seg.segmentationId, count, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x => x.toString(16).padStart(2, '0')).join('') };
      }));
    });
    const rich = receipt.items.find(i => i.externalCaseId === 'train_10382_a_1');
    const zero = receipt.items.find(i => i.externalCaseId === 'train_11272_a_1');
    const initial = await open(rich);
    const first = initial.findings[0], second = initial.findings[1];
    await page.locator('.nw-case.active .nw-tree-finding').nth(1).click();
    await page.locator(`[data-finding-id="${second.id}"].rf-active`).waitFor();
    await page.locator('mark[data-focused=true]').first().waitFor();
    ok('sidebarUsesLiveCountsAndLocatesFindingEvidence');
    await page.locator(`[data-observation-id="${first.observationIds[0]}"]`).click();
    await page.getByRole('region', { name: '报告观察详情' }).waitFor();
    await page.screenshot({ path: path.join(out, 'full-ohif-report.png') });
    await page.getByRole('button', { name: '新建病灶并绘制', exact: true }).click();
    await page.getByRole('tab', { name: '手工编辑', exact: true }).click();
    await page.waitForFunction(() => {
      const s = window.services; return s.toolGroupService.getToolGroupForViewport(s.viewportGridService.getState().activeViewportId).getActivePrimaryMouseButtonTool() === 'CircularBrush';
    });
    const pt = await page.evaluate(() => {
      const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getState().activeViewportId);
      const c = v.worldToCanvas(v.getImageData().imageData.indexToWorld([260, 255, 0])), r = v.element.getBoundingClientRect();
      return { x: r.x + c[0], y: r.y + c[1] };
    });
    await page.mouse.move(pt.x, pt.y); await page.mouse.down(); await page.mouse.move(pt.x + 14, pt.y + 6, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(500); const drawn = (await stats())[0]; assert.ok(drawn.count > 0); ok('reportObservationCreatesDrawableEntity', drawn);
    const saved = page.waitForResponse(r => r.url().includes('/entities/') && r.url().endsWith('/mask-versions') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save All', exact: true }).click(); assert.equal((await saved).status(), 200);
    await page.getByText('已保存 1 / 1 个 mask。', { exact: true }).waitFor();
    let updated = await context(rich); const entity = updated.entities.at(-1);
    assert.ok(entity.maskId); assert.equal(entity.reportObservations[0].observationId, first.observationIds[0]);
    const history = await page.request.get(base + `/monai/nifti-images/${updated.sourceId}/masks/history`);
    assert.equal(history.status(), 200); const version = (await history.json()).items.find(v => v.maskId === entity.maskId);
    assert.equal(version.voxelHash, drawn.hash); assert.equal(version.voxelCount, drawn.count); ok('savedMaskMatchesDrawnVoxelsAndReportObservation', { entityId: entity.id, maskId: entity.maskId, version: version.version, hash: version.voxelHash });
    await page.getByRole('button', { name: '病灶工作台', exact: true }).click();
    await page.locator(`[data-observation-id="${second.observationIds[0]}"]`).click();
    await page.getByRole('combobox', { name: '报告提示关联已有病灶', exact: true }).selectOption(entity.id);
    await page.getByRole('button', { name: '关联报告提示', exact: true }).click();
    await page.waitForFunction(n => document.querySelectorAll('[data-entity-id]').length === n, initial.links.length + 2);
    updated = await context(rich); assert.equal(updated.entities.length, initial.entities.length + 1); assert.equal(updated.entities.at(-1).reportObservations.length, 2);
    assert.ok(updated.links.some(l => l.findingId === first.id && l.entityId === entity.id)); assert.ok(updated.links.some(l => l.findingId === second.id && l.entityId === entity.id));
    ok('twoModelFindingsShareSavedEntity', { entityId: entity.id, observations: updated.entities.at(-1).reportObservations.length });
    await page.screenshot({ path: path.join(out, 'full-ohif-shared.png') });
    await open(zero, true); assert.equal(await page.locator('[data-finding-id]').count(), 0);
    await page.locator('.rf-rejected summary').click(); assert.ok(await page.locator('.rf-rejection').first().isVisible());
    ok('zeroCandidateCTKeepsRejectedMentions', { volume: zero.externalCaseId }); await page.screenshot({ path: path.join(out, 'full-ohif-zero.png') });
    const restored = await open(rich, true); assert.equal(restored.entities.at(-1).id, entity.id); assert.equal(restored.entities.at(-1).maskId, entity.maskId);
    await page.locator(`[data-entity-id="${entity.id}"] .rf-entity-edit`).first().click();
    await page.getByRole('tab', { name: '手工编辑', exact: true }).click();
    await page.waitForFunction(() => window.services.segmentationService.getSegmentations().length === 1);
    const loaded = (await stats())[0]; assert.equal(loaded.hash, drawn.hash); assert.equal(loaded.count, drawn.count);
    ok('caseSwitchAndReopenPreserveSharedEntityEvidenceAndMask', { entityId: entity.id, ...loaded });
    await page.screenshot({ path: path.join(out, 'full-ohif-reopened.png') });
    assert.equal(results.errors.length, 0); results.passed = true;
  } catch (e) { results.passed = false; results.failure = String(e.stack || e); console.error(e); await page.screenshot({ path: path.join(out, 'full-ohif-failure.png') }).catch(() => {}); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(out, 'full-ct-results.json'), JSON.stringify(results, null, 2)); await browser.close(); }
})();
