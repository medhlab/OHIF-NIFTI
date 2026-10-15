import { followingSources } from './casePrefetch';
import { openManifestCase } from './api';
import { annotationRequest } from './annotationClient';
jest.mock('./api',()=>({request:jest.fn(),openManifestCase:jest.fn()}));
jest.mock('./annotationClient',()=>({annotationRequest:jest.fn()}));
jest.mock('./workspace',()=>({getWorkspace:jest.fn()}));
jest.mock('./streaming',()=>({prepareStreaming:jest.fn()}));
test('manifest prefetch is limited to the next two rows and never loops to current',async()=>{
 const w={caseId:'a',manifest:{items:[{caseId:'a',sourceId:'A'},{caseId:'b',sourceId:'B'},{caseId:'c',sourceId:'C'},{caseId:'d',sourceId:'D'}]}};
 expect(await followingSources(w,'A')).toEqual(['B','C']);
});
test('dataset next two follow the selected split/search across pages',async()=>{
 annotationRequest.mockResolvedValueOnce({items:[{sourceId:'old'},{sourceId:'A'}],totalCases:102}).mockResolvedValueOnce({items:[{sourceId:'B'},{sourceId:'C'}],totalCases:102});
 const w={manifest:{prefetchSelection:{datasetId:'rex',split:'val',search:'test'}}};
 expect(await followingSources(w,'A')).toEqual(['B','C']);
 expect(annotationRequest.mock.calls[0][0]).toContain('split=val&search=test');
 expect(annotationRequest.mock.calls[1][0]).toContain('offset=100');
});

test('a not-yet-opened manifest row prepares only its image, never its masks',async()=>{
 openManifestCase.mockResolvedValue({descriptor:{sourceId:'B'}});
 const workspace={caseId:'a',manifest:{base:'/data',items:[{caseId:'a',sourceId:'A'},{caseId:'b',image:'next.nii.gz',segmentations:['mask.nii.gz']}]}};
 expect(await followingSources(workspace,'A')).toEqual(['B']);
 expect(openManifestCase.mock.calls[0][0]).toEqual({image:'next.nii.gz',segmentations:[],base:'/data',unit:undefined,modality:'CT'});
});
