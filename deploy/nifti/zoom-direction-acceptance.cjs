const fs = require('fs'), assert = require('assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL, fixed = process.env.EXPECT_FIXED === 'true';
const result = {base, fixed, checks: [], pageErrors: [], mutationRequests: []};
const out = process.env.OUTPUT_FILE;
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH,
    args:['--enable-unsafe-swiftshader','--no-proxy-server']});
  const p = await browser.newPage({viewport:{width:1600,height:1050}});
  p.setDefaultTimeout(180000);
  p.on('pageerror',e=>result.pageErrors.push(e.message));
  p.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())) result.mutationRequests.push({url:r.url(),method:r.method()});});
  const state = () => p.evaluate(() => {
    const s=window.services, id=s.viewportGridService.getState().activeViewportId,
      v=s.cornerstoneViewportService.getCornerstoneViewport(id), g=s.toolGroupService.getToolGroupForViewport(id);
    const r=v.element.getBoundingClientRect();
    return {scale:v.getCamera().parallelScale, zoom:v.getZoom(), slice:v.getCurrentImageIdIndex(),
      primary:g.getActivePrimaryMouseButtonTool(), invert:g.getToolConfiguration('Zoom').invert,
      point:{x:r.x+r.width/2,y:r.y+r.height/2}};
  });
  const ready = () => p.waitForFunction(()=>{const s=window.services,v=s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getState().activeViewportId);return v?.getCornerstoneImage?.()&&v.getCurrentImageId()===v.getCornerstoneImage().imageId;});
  const zoom = async mode => {
    const before=await state(), {x,y}=before.point;
    await p.mouse.move(x,y); await p.mouse.down({button:'right'});
    await p.mouse.move(x,y-60,{steps:12}); await p.mouse.up({button:'right'});
    const up=await state();
    await p.mouse.down({button:'right'}); await p.mouse.move(x,y,{steps:12}); await p.mouse.up({button:'right'});
    const down=await state();
    assert.equal(before.invert,fixed);
    assert.ok(fixed ? up.scale<before.scale : up.scale>before.scale);
    assert.ok(fixed ? down.scale>up.scale : down.scale<up.scale);
    assert.equal(before.slice,up.slice); assert.equal(before.slice,down.slice);
    assert.equal(before.primary,down.primary);
    result.checks.push({mode,before,up,down}); console.log('PASS',mode);
  };
  const masks=()=>p.evaluate(()=>window.services.segmentationService.getSegmentations().map(seg=>{
    let hash=2166136261,count=0;
    for(const id of seg.representationData.Labelmap.imageIds){const data=window.cornerstone.cache.getImage(id).voxelManager.getScalarData();
      for(let i=0;i<data.length;i++){hash=Math.imul(hash^data[i],16777619);if(data[i])count++;}}
    return {id:seg.segmentationId,hash:hash>>>0,count};
  }));
  try {
    await p.goto(base+'/nifti?manifestId=bc1ed805723b4150ad6451bad378d955&caseId=valid_1_a_2',{waitUntil:'domcontentloaded'});
    await p.getByRole('button',{name:'打开病灶工作台',exact:true}).waitFor(); await ready();
    await zoom('browse');
    if(fixed){
      const before=await state(); const {x,y}=before.point;
      const cameraBefore=await p.evaluate(()=>{const s=window.services;return s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getState().activeViewportId).getCamera().focalPoint;});
      await p.mouse.move(x,y); await p.mouse.down(); await p.mouse.move(x+30,y,{steps:6}); await p.mouse.up();
      const cameraAfter=await p.evaluate(()=>{const s=window.services;return s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getState().activeViewportId).getCamera().focalPoint;});
      assert.notDeepEqual(cameraBefore,cameraAfter); assert.equal((await state()).scale,before.scale);
      await p.mouse.wheel(0,120); await p.waitForFunction(i=>{const s=window.services;return s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getState().activeViewportId).getCurrentImageIdIndex()!==i;},before.slice); await ready();
      result.checks.push({mode:'leftPanAndWheelScroll',before,after:await state()});
      await p.getByRole('button',{name:'标注与 AI',exact:true}).click();
      await p.getByRole('tab',{name:'手工编辑',exact:true}).click();
      await p.waitForFunction(()=>{const s=window.services;return s.toolGroupService.getToolGroupForViewport(s.viewportGridService.getState().activeViewportId).getActivePrimaryMouseButtonTool()==='CircularBrush'});
      const beforeMasks=await masks(); await zoom('manual'); assert.deepEqual(await masks(),beforeMasks);
      await p.getByRole('tab',{name:'AI 提示',exact:true}).click();
      const probe=p.locator('[data-tool=Probe2]'); if(await probe.getAttribute('aria-pressed')!=='true') await probe.click();
      await p.waitForFunction(()=>{const s=window.services;return s.toolGroupService.getToolGroupForViewport(s.viewportGridService.getState().activeViewportId).getActivePrimaryMouseButtonTool()==='Probe2'});
      await zoom('aiPrompt'); assert.deepEqual(await masks(),beforeMasks);
      result.checks.push({mode:'maskPixelsUnchanged',masks:beforeMasks});
      result.toolGroups=await p.evaluate(()=>['default','mpr'].map(id=>({id,invert:window.services.toolGroupService.getToolGroup(id).getToolConfiguration('Zoom').invert})));
      assert.ok(result.toolGroups.every(g=>g.invert===true));
      assert.ok(!result.mutationRequests.some(r=>/\/infer$|\/masks(?:\?|$)/.test(r.url)));
    }
    assert.equal(result.pageErrors.length,0); result.passed=true;
  } catch(e) {result.passed=false;result.failure=String(e.stack||e);console.error(e);process.exitCode=1;}
  finally {fs.writeFileSync(out,JSON.stringify(result,null,2));await browser.close();}
})();
