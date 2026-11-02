// @vitest-environment jsdom
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,describe,it,vi,expect} from 'vitest';
import UsageCard from '../app/components/billing/UsageCard';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('usage availability display',()=>{
  it('shows unavailable for a failed response and supports explicit refresh',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce({ok:false,json:async()=>({error:'Unavailable'})}).mockResolvedValue({ok:true,json:async()=>({usage:[{metric:'actions_active',count:7,limit:50}]})});
    vi.stubGlobal('fetch',fetcher);render(<UsageCard periodStart={null} periodEnd={null} tier="core"/>);
    expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('Active actions')).toBeNull();fireEvent.click(screen.getByRole('button',{name:/refresh/i}));
    await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());expect(await screen.findByText('Active actions')).toBeTruthy();
  });
});
