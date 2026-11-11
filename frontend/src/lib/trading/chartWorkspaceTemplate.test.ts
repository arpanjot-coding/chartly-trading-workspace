import { describe, expect, it } from 'vitest'
import type { WorkspacePayload } from 'chartly-charts/workspace'
import { templateForChartSource } from './chartWorkspaceTemplate'
const payload:WorkspacePayload={layout:{rows:1,columns:1,slots:[{paneId:'p0',row:0,column:0,rowSpan:1,columnSpan:1}]},activePaneId:'p0',sync:{crosshair:true,viewport:true,symbol:false,interval:false},panes:[{id:'p0',symbol:'EXAMPLE',exchange:'LOCAL',interval:'5m',chartType:'candlestick',chart:{version:1,drawings:{version:2,drawings:[{id:'line-one',tool:'trend-line',paneIndex:0,points:[],style:{},zIndex:0}]},alerts:{version:1,alerts:[]},indicators:[]},settings:{},volume:true,magnet:'off',stay:false,comparisons:[],comparisonMode:'price'}]}
describe('deliberate chart configuration templates',()=>{
  it('preserves raw original and rebinds only a copy to the exact native source',()=>{
    const before=structuredClone(payload)
    const copy=templateForChartSource(payload,{symbol:'OTHER',exchange:'VENUE',interval:'1m'})
    expect(payload).toEqual(before);expect(copy.panes[0]).toMatchObject({symbol:'OTHER',exchange:'VENUE',interval:'1m',comparisons:[]})
    expect(copy.panes[0].chart.drawings).toEqual({version:2,drawings:[]});expect(copy.panes[0].chart.alerts).toEqual({version:1,alerts:[]})
    expect(copy.layout).toEqual(payload.layout)
  })
  it('clears drawing provenance even when only the dataset/provider/economic basis changes',()=>{
    const copy=templateForChartSource(payload,{symbol:'EXAMPLE',exchange:'LOCAL',interval:'1m'})
    expect(copy.panes[0].chart.drawings).toEqual({version:2,drawings:[]})
  })
  it('retains existing unbound legacy import semantics',()=>{
    const copy=templateForChartSource(payload)
    expect(copy.panes[0].symbol).toBe(payload.panes[0].symbol);expect(copy.panes[0].interval).toBe('5m')
  })
})
