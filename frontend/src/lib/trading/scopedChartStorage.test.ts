import { beforeEach, describe, expect, it } from 'vitest'
import { chartPreferenceName, CHART_PREFERENCES_KEY, scopedChartStorage, validChartPreferenceEnvelope } from './scopedChartStorage'
beforeEach(()=>localStorage.clear())
describe('private chart preference envelope',()=>{
  it('isolates profiles, sources and the original browser keys',()=>{
    localStorage.setItem('oa-trading-p0-symbol','original')
    const one=scopedChartStorage('owner:profile-1:dataset:version-one'),two=scopedChartStorage('owner:profile-2:dataset:version-one')
    expect(one.getItem('oa-trading-p0-symbol')).toBeNull()
    one.setItem('oa-trading-p0-symbol','private-one')
    expect(two.getItem('oa-trading-p0-symbol')).toBeNull();expect(localStorage.getItem('oa-trading-p0-symbol')).toBe('original')
    expect(scopedChartStorage('owner:profile-1:dataset:version-one').getItem('oa-trading-p0-symbol')).toBe('private-one')
    expect(scopedChartStorage()).toBe(localStorage)
  })
  it('saves a bounded data-only map under the recovery allowlist key',()=>{
    const store=scopedChartStorage('owner:profile-1:dataset:version-one')
    store.setItem('oa-trading-layout','quad');store.setItem('oa-trading-dock','positions');store.setItem('oa-trading-p15-draw:LOCAL:EXAMPLE','{"version":2,"drawings":[]}')
    const key=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).find((key)=>key&&CHART_PREFERENCES_KEY.test(key))!
    expect(validChartPreferenceEnvelope(localStorage.getItem(key)!)).toBe(true)
    expect(store.length).toBe(3);store.removeItem('oa-trading-layout');expect(store.getItem('oa-trading-layout')).toBeNull()
  })
  it.each(['api_key','oa-agent-model','oa-trading-script-draft:secret.oscript','oa-trading-p16-symbol','oa-trading-p0-password','__proto__'])('cannot retain a non-chart or out-of-budget key %s',(key)=>{
    const store=scopedChartStorage('owner:profile-1:dataset:version-one');store.setItem(key,'secret');expect(store.getItem(key)).toBeNull();expect(chartPreferenceName(key)).toBe(false)
  })
  it('rejects malformed/large map values and oversized contexts',()=>{
    expect(validChartPreferenceEnvelope('[]')).toBe(false);expect(validChartPreferenceEnvelope('{"api_key":"secret"}')).toBe(false)
    expect(validChartPreferenceEnvelope(JSON.stringify({'oa-trading-layout':{bad:true}}))).toBe(false)
    expect(()=>scopedChartStorage('x'.repeat(241))).toThrow()
    expect(()=>scopedChartStorage('owner:profile-1').setItem('oa-trading-p0-draw','x'.repeat(1024*1024+1))).toThrow(/supported size/)
  })
})
