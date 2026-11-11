import { describe, expect, it } from 'vitest'
import type { WorkspaceCatalog, WorkspaceDocument } from 'chartly-charts/workspace'
import type { DatasetVersion } from '@/api/dataLibrary'
import type { ResolvedChartContext } from './chartContext'
import { preservedChartSetups } from './chartWorkspaceRecovery'
const document:WorkspaceDocument={kind:'workspace',version:1,id:'saved-workspace',name:'Preserved chart',createdAt:1,updatedAt:1,layout:{rows:1,columns:1,slots:[{paneId:'p0',row:0,column:0,rowSpan:1,columnSpan:1}]},activePaneId:'p0',sync:{crosshair:true,viewport:true,symbol:false,interval:false},panes:[{id:'p0',symbol:'EXAMPLE',exchange:'LOCAL',interval:'1m',chartType:'candlestick',chart:{version:1,drawings:{version:2,drawings:[{id:'line-one',tool:'trend-line',paneIndex:0,points:[],style:{},zIndex:0}]},indicators:[]},settings:{},volume:false,magnet:'off',stay:false,comparisons:[],comparisonMode:'price'}]}
const catalog:WorkspaceCatalog={version:1,revision:1,workspaces:[document],templates:[],recentWorkspaceIds:[document.id],activeWorkspaceId:document.id,autosave:true}
const context={namespace:'oa-trading:new-owner:profile-1:run-2:dataset:version-new',navigation:new URLSearchParams({datasetVersionId:'version-old'}),profile:{id:1},run:{id:2},dataset:{id:'version-new',metadata:{symbol:'EXAMPLE',exchange:'LOCAL',interval:'1m'}} as DatasetVersion} as ResolvedChartContext
describe('deliberate restored chart setup recovery',()=>{
  it('retains drawings for the exact verified old alias/profile/run scope while preserving original bytes',()=>{
    const native={'openalgo-chart-workspaces':{'oa-trading:old-owner:profile-1:run-2:dataset:version-old':structuredClone(catalog)}}
    const before=structuredClone(native),setups=preservedChartSetups(native,context)
    expect(setups).toHaveLength(1);expect(setups[0].sameSource).toBe(true)
    expect(setups[0].payload.panes[0].chart.drawings?.drawings).toHaveLength(1);expect(native).toEqual(before)
  })
  it.each(['oa-trading:old-owner:profile-3:run-2:dataset:version-old','oa-trading:old-owner:profile-1:run-3:dataset:version-old','oa-trading:old-owner:profile-1:run-2:dataset:other-version','oa-trading:old-owner'])('clears copied drawings for unproven source scope %s',(namespace)=>{
    const [setup]=preservedChartSetups({'openalgo-chart-workspaces':{[namespace]:catalog}},context)
    expect(setup.sameSource).toBe(false);expect(setup.payload.panes[0].chart.drawings?.drawings).toEqual([])
    expect(catalog.workspaces[0].panes[0].chart.drawings?.drawings).toHaveLength(1)
  })
  it('requires matching native instrument/venue even within a matching namespace',()=>{
    const changed=structuredClone(catalog);changed.workspaces[0].panes[0].exchange='OTHER'
    const [setup]=preservedChartSetups({'openalgo-chart-workspaces':{'oa-trading:old-owner:profile-1:run-2:dataset:version-old':changed}},context)
    expect(setup.sameSource).toBe(false);expect(setup.payload.panes[0].chart.drawings?.drawings).toEqual([])
  })
  it('skips corrupt and current catalogs and bounds a restored chooser to 100 setups',()=>{
    expect(preservedChartSetups({'openalgo-chart-workspaces':{bad:{},[context.namespace]:catalog}},context)).toEqual([])
    const catalogs=Object.fromEntries(Array.from({length:150},(_,index)=>[`oa-trading:old-${index}`,catalog]))
    expect(preservedChartSetups({'openalgo-chart-workspaces':catalogs},context)).toHaveLength(100)
  })
})
