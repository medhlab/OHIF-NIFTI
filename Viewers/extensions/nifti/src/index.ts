import { StackViewport } from '@cornerstonejs/core';
import { installStackScrollGuard } from './stackScrollGuard.mjs';
import { registerNifti, memorySnapshot, navigateNifti } from './sourceStore';
import { createDataSource, getSopClassHandlerModule } from './dataSource';
import WorkspacePanel from './WorkspacePanel';
import AnnotationToolbar from './AnnotationToolbar';
import CaseFilesPanel from './CaseFilesPanel';
import { attachMaskEvents } from './masks';
import { installEditingGuard } from './editing';
import { installAnatomyReadOnlyGuard } from './readonly';

export { default as NiftiGateway } from './Gateway';
export { default as NiftiIcon } from './NiftiIcon';
export { releaseAllSources } from './sourceStore';
export { activateNativeBrowse } from './navigation';
export default {
  id: '@ohif/extension-nifti',
  preRegistration({ appConfig, servicesManager }) {
    installStackScrollGuard(StackViewport, navigateNifti);
    registerNifti(appConfig);
    attachMaskEvents();
    installAnatomyReadOnlyGuard(servicesManager);
    installEditingGuard(servicesManager);
    if (
      appConfig.enableNiftiViewing &&
      !appConfig.dataSources.some(s => s.sourceName === 'nifti')
    ) {
      appConfig.dataSources.push({
        namespace: '@ohif/extension-nifti.dataSourcesModule.nifti',
        sourceName: 'nifti',
        configuration: { friendlyName: 'Native NIfTI' },
      });
    }
  },
  getDataSourcesModule: ({ commandsManager }) => [
    { name: 'nifti', type: 'niftiApi', createDataSource: () => createDataSource(commandsManager) },
  ],
  getSopClassHandlerModule,
  getUtilityModule: () => [{ name: 'diagnostics', exports: { memorySnapshot } }],
  getToolbarModule: () => [
    { name: 'nifti.annotationToolbar', defaultComponent: AnnotationToolbar },
  ],
  getPanelModule: () => [
    {
      name: 'nifti',
      iconName: 'tab-segmentation',
      label: '报告与标注',
      component: WorkspacePanel,
      providesOwnHeader: true,
    },
    { name: 'caseFiles', iconName: 'tab-studies', label: '病例与文件', component: CaseFilesPanel },
  ],
};
