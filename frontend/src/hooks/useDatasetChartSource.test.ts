import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dataLibrary, type DatasetVersion } from '@/api/dataLibrary'
import { useDatasetChartSource } from './useDatasetChartSource'
const version:DatasetVersion={id:'version-one',datasetId:'dataset-one',name:'Test history',checksum:'a'.repeat(64),sourceHash:'b'.repeat(64),rowCount:2,start:1000,end:1060,sizeBytes:100,createdAt:'2026-11-03T09:00:00Z',quality:{},coverage:{},dependencies:[],metadata:{provider:'fixture',symbol:'EXAMPLE',exchange:'LOCAL',interval:'1m',currency:'USD',priceBasis:'raw',adjustment:'none',volumeMeaning:'unknown',allowNegativePrices:false,calendar:{id:'unknown',timezone:'UTC',sessions:[],exceptions:{}}}}
afterEach(()=>vi.restoreAllMocks())
describe('StrictMode source lifetime',()=>{
  it('keeps the original-terminal source usable after effect replay and closes it on real exit',async()=>{
    vi.spyOn(dataLibrary,'bars').mockResolvedValue({versionId:version.id,checksum:version.checksum,bars:[{timestamp:1000,open:'1',high:'2',low:'1',close:'2',volume:null}]})
    const {result,unmount}=renderHook(()=>useDatasetChartSource(version),{reactStrictMode:true})
    const source=result.current!
    await act(async()=>{expect(await source.feed.getBars({symbol:'EXAMPLE',exchange:'LOCAL',interval:'1m',from:1000,to:1120})).toHaveLength(1)})
    unmount();await Promise.resolve()
    await expect(source.feed.getBars({symbol:'EXAMPLE',exchange:'LOCAL',interval:'1m',from:1000,to:1120})).rejects.toThrow()
  })
  it('closes the outgoing source even when a new effect owner is mounted',async()=>{
    const other={...version,id:'version-two'}
    vi.spyOn(dataLibrary,'bars').mockImplementation(async(id)=>({versionId:id,checksum:version.checksum,bars:[{timestamp:1000,open:'1',high:'2',low:'1',close:'2',volume:null}]}))
    const {result,rerender,unmount}=renderHook(({value})=>useDatasetChartSource(value),{initialProps:{value:version},reactStrictMode:true})
    const old=result.current!
    rerender({value:other});await Promise.resolve()
    await expect(old.feed.getBars({symbol:'EXAMPLE',exchange:'LOCAL',interval:'1m',from:1000,to:1120})).rejects.toThrow()
    await expect(result.current!.feed.getBars({symbol:'EXAMPLE',exchange:'LOCAL',interval:'1m',from:1000,to:1120})).resolves.toHaveLength(1)
    unmount();await Promise.resolve()
  })
})
