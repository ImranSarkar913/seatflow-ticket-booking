import {it,expect} from 'vitest';
import {money} from './api';
it('displays the exact paisa amount rather than rounding the price',()=>{expect(money(125050)).toContain('1,250.50');expect(money(100001)).toContain('1,000.01');});
