import { Hono } from 'hono';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { complete } from './complete.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { daily } from './daily.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { share } from './share.ts';

export const api = new Hono();

api.route('/daily', daily);
api.route('/complete', complete);
api.route('/share', share);
