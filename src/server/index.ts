import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { api } from './routes/api.ts';
// @ts-expect-error - Node --experimental-strip-types requires .ts extension
import { menu } from './routes/menu.ts';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);

app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
