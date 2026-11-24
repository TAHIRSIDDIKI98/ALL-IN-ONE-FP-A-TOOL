import { createSpineApp } from './app.js';

const port = Number.parseInt(process.env['PORT'] ?? '3001', 10);
const host = process.env['HOST'] ?? '127.0.0.1';

const app = createSpineApp();

app.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({ event: 'server_started', host, port, milestone: 'M0' })}\n`,
  );
});
